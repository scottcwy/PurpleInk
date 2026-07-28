import { describe, expect, it, vi } from 'vitest'
import { loadExportReadiness, startProjectExport, updateExportResolution } from './export-api'

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
      degradedReady: false,
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
      blockingIssues: [],
      media: {
        narrationReadyCount: 0,
        subtitleReadyCount: 0,
        requiredShotCount: 0,
        delivery: 'narration-hard-subtitle-v2',
      },
      placeholderCandidateLanes: [],
      degradedReady: false,
      degradedExport: null,
      artifactDelivery: 'none',
    })
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
