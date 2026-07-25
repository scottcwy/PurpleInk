import { describe, expect, it, vi } from 'vitest'
import {
  analyzeVision,
  runShotVisionQa,
  storeVisionQaReport,
  type ShotVisionQaDependencies,
} from './vision-qa'
import type {
  ShotQaVisionData,
  ThumbnailContext,
  ThumbnailResult,
} from './types'
import type { StorageAdapter } from '@/lib/storage'

vi.mock('server-only', () => ({}))

const context: ThumbnailContext = {
  projectId: 'project-1',
  nodeId: 'codegen-1',
  htmlKey: 'html/S001.html',
  frames: { fps: 30, durationInFrames: 60, width: 1920, height: 1080 },
}
const thumbnails: ThumbnailResult[] = [
  { fraction: 0.25, frame: 14, artifactId: 'thumb-1', contentHash: 'hash-1' },
  { fraction: 0.6, frame: 35, artifactId: 'thumb-2', contentHash: 'hash-2' },
  { fraction: 0.95, frame: 56, artifactId: 'thumb-3', contentHash: 'hash-3' },
]

function harness() {
  const analyze = vi.fn(async () => ({
    model: 'step-3.7-flash',
    provider: 'stepfun' as const,
    report: {
      summary: '合同检查完成',
      mustShow: [
        { requirement: '主标题', passed: true, evidence: '60% 帧可见' },
      ],
      mustAvoid: [
        { requirement: '水印', passed: true, evidence: '三帧均未见' },
      ],
      findings: [],
    },
  }))
  const storeReport = vi.fn(async (input: {
    buildProjection(stored: {
      id: string
      storageKey: string
      contentHash: string
    }): ShotQaVisionData
  }) => {
    const pointer = {
      id: 'report-1',
      storageKey: 'qa/project-1/qa-1/report.json',
      contentHash: 'report-hash',
    }
    return { ...pointer, qaVision: input.buildProjection(pointer) }
  })
  const deps: ShotVisionQaDependencies = {
    repository: {
      getShotQaTargets: async () => [
        { codegenNodeId: 'codegen-1', qaNodeId: 'qa-1', laneKey: 'S001' },
      ],
      loadCompletedThumbnailContext: async () => context,
    },
    capture: vi.fn(async () => thumbnails),
    readArtifactBytes: vi.fn(async (_projectId, artifactId) =>
      Buffer.from(`png:${artifactId}`)
    ),
    analyze,
    storeReport,
    now: () => 456,
  }
  return { deps, analyze, storeReport }
}

describe('runShotVisionQa', () => {
  it('normalizes contract coverage, stores a report, and writes a traceable node result', async () => {
    const target = harness()

    const result = await runShotVisionQa(
      {
        projectId: 'project-1',
        qaNodeId: 'qa-1',
        shot: {
          id: 'S001',
          mustShow: ['主标题'],
          mustAvoid: ['水印'],
        },
      },
      target.deps
    )

    expect(target.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        shotId: 'S001',
        mustShow: ['主标题'],
        mustAvoid: ['水印'],
        images: [
          { label: '25%', bytes: Buffer.from('png:thumb-1') },
          { label: '60%', bytes: Buffer.from('png:thumb-2') },
          { label: '95%', bytes: Buffer.from('png:thumb-3') },
        ],
      })
    )
    expect(target.storeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        nodeId: 'qa-1',
        report: expect.objectContaining({
          version: 1,
          passed: true,
          model: 'step-3.7-flash',
          provider: 'stepfun',
          thumbnailArtifactIds: ['thumb-1', 'thumb-2', 'thumb-3'],
        }),
      })
    )
    expect(result).toMatchObject({
      passed: true,
      checkedAt: 456,
      reportArtifactId: 'report-1',
      reportKey: 'qa/project-1/qa-1/report.json',
    })
  })

  it('rejects model output that omits a mustShow contract item', async () => {
    const target = harness()
    target.analyze.mockResolvedValueOnce({
      model: 'step-3.7-flash',
      provider: 'stepfun' as const,
      report: {
        summary: '遗漏合同项',
        mustShow: [],
        mustAvoid: [
          { requirement: '水印', passed: true, evidence: '未见' },
        ],
        findings: [],
      },
    })

    await expect(
      runShotVisionQa(
        {
          projectId: 'project-1',
          qaNodeId: 'qa-1',
          shot: { id: 'S001', mustShow: ['主标题'], mustAvoid: ['水印'] },
        },
        target.deps
      )
    ).rejects.toThrow('mustShow 合同覆盖不完整')
    expect(target.storeReport).not.toHaveBeenCalled()
  })

  it('fails when the requested QA node has no rendered lane target', async () => {
    const target = harness()

    await expect(
      runShotVisionQa(
        {
          projectId: 'project-1',
          qaNodeId: 'missing',
          shot: { id: 'S001', mustShow: [], mustAvoid: [] },
        },
        target.deps
      )
    ).rejects.toThrow('不具备 Vision QA 前置条件')
  })
})

describe('routed Vision client and report storage', () => {
  const target = {
    provider: 'gemini' as const,
    apiKey: 'test-key',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    modelId: 'gemini-3.6-flash',
  }

  it('uses the resolved vision model and sends PNG data URLs through the compatible API', async () => {
    const complete = vi.fn(async () =>
      '```json\n{"summary":"通过","mustShow":[],"mustAvoid":[],"findings":[]}\n```'
    )

    const result = await analyzeVision(
      {
        shotId: 'S001',
        mustShow: [],
        mustAvoid: [],
        images: [{ label: '25%', bytes: Buffer.from([1, 2, 3]) }],
      },
      { resolveTarget: () => target, complete }
    )

    expect(result).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.6-flash',
    })
    expect(complete).toHaveBeenCalledWith(
      target,
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'image_url',
              image_url: expect.objectContaining({
                url: 'data:image/png;base64,AQID',
              }),
            }),
          ]),
        }),
      ])
    )
  })

  it('refuses Vision calls before transport when the StepFun key is absent', async () => {
    const complete = vi.fn()

    await expect(
      analyzeVision(
        { shotId: 'S001', mustShow: [], mustAvoid: [], images: [] },
        {
          resolveTarget: () => ({ ...target, apiKey: null }),
          complete,
        }
      )
    ).rejects.toThrow('API Key 未配置')
    expect(complete).not.toHaveBeenCalled()
  })

  it('deletes report bytes when artifact registration fails', async () => {
    const target: StorageAdapter = {
      put: vi.fn(async (key: string) => key),
      get: vi.fn(),
      exists: vi.fn(),
      localPath: vi.fn(),
      delete: vi.fn(),
      tempDir: vi.fn(),
      readLocalFile: vi.fn(),
      removeTempDir: vi.fn(),
    }

    await expect(
      storeVisionQaReport(
        {
          projectId: 'project-1',
          nodeId: 'qa-1',
          report: {
            version: 1,
            shotId: 'S001',
            provider: 'gemini',
            model: 'vision-model',
            passed: true,
            summary: '通过',
            mustShow: [],
            mustAvoid: [],
            findings: [],
            thumbnailArtifactIds: ['thumb-1'],
          },
          buildProjection: ({ id, storageKey }) => ({
            passed: true,
            checkedAt: 1,
            thumbnailContentHash: 'thumb-hash',
            provider: 'gemini',
            model: 'vision-model',
            summary: '通过',
            reportArtifactId: id,
            reportKey: storageKey,
          }),
        },
        {
          storage: target,
          commit: vi.fn(async () => {
            throw new Error('索引失败')
          }),
        }
      )
    ).rejects.toThrow('索引失败')
    expect(target.delete).toHaveBeenCalledOnce()
  })
})
