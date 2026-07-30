import { describe, expect, it, vi } from 'vitest'
import {
  loadExportReadiness,
  startProjectExport,
  updateExportResolution,
  waitForExportArtifact,
} from './export-api'

describe('export API client', () => {
  it('loads incomplete nodes and keeps export disabled', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        ok: true,
        ready: false,
        incompleteNodeIds: ['node-2'],
        shotCount: 1,
        shotQa: { S001: null, S002: true },
        resolutionPreset: '1280x720',
        blockingIssues: [
          { laneKey: 'S001', kind: 'subtitle', code: 'artifact-missing' },
        ],
        media: {
          narrationReadyCount: 1,
          subtitleReadyCount: 0,
          requiredShotCount: 1,
          delivery: 'narration-hard-subtitle-v2',
        },
        artifactDelivery: 'legacy-silent-v1',
        artifactUrl: '/api/artifacts/final?projectId=project-1',
      })
    )
    await expect(loadExportReadiness('project-1', fetcher)).resolves.toEqual({
      ready: false,
      incompleteNodeIds: ['node-2'],
      shotCount: 1,
      shotQa: { S001: null, S002: true },
      resolutionPreset: '1280x720',
      subtitles: 'burn-in',
      blockingIssues: [
        { laneKey: 'S001', kind: 'subtitle', code: 'artifact-missing' },
      ],
      media: {
        narrationReadyCount: 1,
        subtitleReadyCount: 0,
        requiredShotCount: 1,
        delivery: 'narration-hard-subtitle-v2',
      },
      placeholderCandidateLanes: [],
      waivedQaLanes: [],
      degradedReady: false,
      confirmationFingerprint: null,
      degradedExport: null,
      artifactDelivery: 'legacy-silent-v1',
      artifactUrl: '/api/artifacts/final?projectId=project-1',
    })
  })

  it('defaults shotQa/resolutionPreset when the response omits them', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({ ok: true, ready: true, incompleteNodeIds: [], shotCount: 0 })
    )
    await expect(loadExportReadiness('project-1', fetcher)).resolves.toEqual({
      ready: true,
      incompleteNodeIds: [],
      shotCount: 0,
      shotQa: {},
      resolutionPreset: '1920x1080',
      subtitles: 'burn-in',
      blockingIssues: [],
      media: {
        narrationReadyCount: 0,
        subtitleReadyCount: 0,
        requiredShotCount: 0,
        delivery: 'narration-hard-subtitle-v2',
      },
      placeholderCandidateLanes: [],
      waivedQaLanes: [],
      degradedReady: false,
      confirmationFingerprint: null,
      degradedExport: null,
      artifactDelivery: 'none',
    })
  })

  it('keeps an unmeasured subtitle count as null instead of collapsing it to zero', async () => {
    // 服务端在「本次交付不含字幕」时投影 null。塌成 0 会让页面显示「字幕 0/5」，
    // 被读成「字幕一个都没好」。
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        ok: true,
        ready: true,
        incompleteNodeIds: [],
        shotCount: 2,
        subtitles: 'off',
        media: {
          narrationReadyCount: 2,
          subtitleReadyCount: null,
          requiredShotCount: 2,
          delivery: 'narration-no-subtitle-v3',
        },
      })
    )

    const readiness = await loadExportReadiness('project-1', fetcher)

    expect(readiness.subtitles).toBe('off')
    expect(readiness.media.subtitleReadyCount).toBeNull()
    expect(readiness.media.delivery).toBe('narration-no-subtitle-v3')
  })

  it('polls the export job until it yields the controlled final artifact URL', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ok: true, jobId: 'job-1' }))
      .mockResolvedValueOnce(json({ ok: true, job: { status: 'running' } }))
      .mockResolvedValueOnce(
        json({
          ok: true,
          job: { status: 'done' },
          artifactUrl: '/api/artifacts/final?projectId=project-1',
        })
      )
    const wait = vi.fn(async () => {})

    await expect(
      startProjectExport('project-1', fetcher, wait)
    ).resolves.toBe('/api/artifacts/final?projectId=project-1')

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/jobs/job-1?projectId=project-1'
    )
    expect(wait).toHaveBeenCalledTimes(1)
  })

  it('surfaces the job failure message instead of a generic error', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ok: true, jobId: 'job-1' }))
      .mockResolvedValueOnce(
        json({ ok: true, job: { status: 'failed', error: '配乐 artifact 文件不存在' } })
      )

    await expect(
      startProjectExport('project-1', fetcher, async () => {})
    ).rejects.toThrow('配乐 artifact 文件不存在')
  })

  it('explains an unready project instead of reporting a bare failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({ ok: false, incompleteNodeIds: ['node-1', 'node-2'] }, 409)
    )

    await expect(
      startProjectExport('project-1', fetcher, async () => {})
    ).rejects.toThrow('还有 2 个节点未产出可用分镜')
  })

  it('binds a degraded export request to the readiness confirmation fingerprint', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ok: true, jobId: 'job-1' }))
      .mockResolvedValueOnce(
        json({
          ok: true,
          job: { status: 'done' },
          artifactUrl: '/api/artifacts/final?projectId=project-1',
        }),
      )

    await startProjectExport('project-1', fetcher, async () => {}, {
      degraded: true,
      confirmationFingerprint: 'sha256:current',
    })

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/render/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'project-1',
        degraded: true,
        confirmationFingerprint: 'sha256:current',
      }),
    })
  })

  it('projects waived QA lanes and keeps old degraded manifests compatible', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        ok: true,
        ready: false,
        incompleteNodeIds: ['shot-qa-s002'],
        shotCount: 2,
        waivedQaLanes: ['S002'],
        degradedReady: true,
        confirmationFingerprint: 'sha256:current',
        degradedExport: { placeholderLanes: ['S001'] },
      })
    )

    const readiness = await loadExportReadiness('project-1', fetcher)

    expect(readiness.waivedQaLanes).toEqual(['S002'])
    expect(readiness.confirmationFingerprint).toBe('sha256:current')
    expect(readiness.degradedExport).toEqual({
      placeholderLanes: ['S001'],
      waivedQaLanes: [],
    })
  })

  it('explains media blocking issues without exposing artifact paths', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json(
        {
          ok: false,
          incompleteNodeIds: [],
          blockingIssues: [
            { laneKey: 'S002', kind: 'narration', code: 'artifact-missing' },
          ],
        },
        409
      )
    )

    await expect(
      startProjectExport('project-1', fetcher, async () => {})
    ).rejects.toThrow('S002 缺旁白')
  })

  it('rejects a completed job that has no downloadable artifact', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ok: true, jobId: 'job-1' }))
      .mockResolvedValueOnce(json({ ok: true, job: { status: 'done' } }))

    await expect(
      startProjectExport('project-1', fetcher, async () => {})
    ).rejects.toThrow('缺少产物')
  })

  it('stops waiting at the wall-clock deadline instead of polling forever', async () => {
    // 永不写回终态的作业（例如进程被杀）不能让 UI 永远停在「处理中」——
    // 那条进度骨架屏会变成永久 Skeleton。
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => json({ ok: true, job: { status: 'running' } }))
    let clock = 0
    const wait = vi.fn(async () => {
      clock += 60 * 1_000
    })

    await expect(
      waitForExportArtifact('project-1', 'job-1', fetcher, wait, () => clock)
    ).rejects.toThrow('导出等待超时')

    // 30 分钟上限 / 每轮推进 1 分钟：第 30 轮触发截止，不再继续轮询。
    expect(wait).toHaveBeenCalledTimes(30)
  })

  it('keeps polling while the deadline has not been reached', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ ok: true, job: { status: 'running' } }))
      .mockResolvedValueOnce(
        json({
          ok: true,
          job: { status: 'done' },
          artifactUrl: '/api/artifacts/final?projectId=project-1',
        })
      )

    await expect(
      waitForExportArtifact(
        'project-1',
        'job-1',
        fetcher,
        async () => {},
        () => 0
      )
    ).resolves.toBe('/api/artifacts/final?projectId=project-1')
  })

  it('PATCHes the resolution preset to the project settings API', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({ ok: true, exportSettings: { resolutionPreset: '1280x720' } })
    )
    await expect(
      updateExportResolution('project-1', '1280x720', fetcher)
    ).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenCalledWith('/api/projects/project-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ exportSettings: { resolutionPreset: '1280x720' } }),
    })
  })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
