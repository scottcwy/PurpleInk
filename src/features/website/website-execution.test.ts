import { describe, expect, it, vi } from 'vitest'
import {
  runWebsiteVideo,
  type WebsiteExecutionDependencies,
} from './website-execution'
import type { WebsiteEngineJob } from './engine-client'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const PROJECT_ID = '00000000-0000-4000-8000-000000000101'
const ATTEMPT_ID = '00000000-0000-4000-8000-000000000201'
const SOURCE_HASH = 'a'.repeat(64)

describe('runWebsiteVideo', () => {
  it('runs the engine and completes with the committed artifact', async () => {
    const completed = completedJob()
    const stages = stageProjector()
    const start = vi.fn(async () => ({ reused: false, job: completed }))
    const output = {
      artifactId: 'artifact-1',
      soundEffectsManifestArtifactId: 'manifest-1',
      storageKey: `website/${PROJECT_ID}/${ATTEMPT_ID}/video.mp4`,
      contentHash: 'b'.repeat(64),
      sizeBytes: 24,
      durationSec: 29,
      durationSource: 'output' as const,
      elapsedSec: 29,
      verification: {
        checkPassed: true,
        goldenVerified: true,
        goldenCheckCount: 2,
        outcome: 'passed' as const,
      },
    }

    const result = await runWebsiteVideo(runInput(), dependencies({
      engine: {
        start,
        getJob: vi.fn(),
        downloadVideo: vi.fn(async () => Buffer.from('mp4')),
      },
      stages,
      persistOutput: vi.fn(async () => output),
    }))

    expect(result).toEqual(output)
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: WORKSPACE_ID,
      attemptId: ATTEMPT_ID,
      url: 'https://example.com/product?campaign=private',
      name: '产品主页',
      soundEffects: 'procedural',
    }))
    expect(stages.complete).toHaveBeenCalledWith(PROJECT_ID, output)
    expect(stages.fail).not.toHaveBeenCalled()
  })

  it('projects only a safe failure code when the engine fails before a phase starts', async () => {
    const stages = stageProjector()
    const failure = completedJob({
      status: 'failed',
      phase: 'failed',
      hasVideo: false,
      failure: { code: 'ENGINE_JOB_FAILED' },
    })
    await expect(runWebsiteVideo(runInput(), dependencies({
      engine: {
        start: vi.fn(async () => ({ reused: false, job: failure })),
        getJob: vi.fn(),
        downloadVideo: vi.fn(),
      },
      stages,
    }))).rejects.toMatchObject({ code: 'WEBSITE_ENGINE_FAILED' })
    expect(stages.fail).toHaveBeenCalledWith(
      PROJECT_ID,
      'capture',
      'WEBSITE_ENGINE_FAILED',
    )
    expect(JSON.stringify(stages.fail.mock.calls)).not.toContain('example.com')
  })

  it('blocks a degraded delivery after persisting its real output', async () => {
    const stages = stageProjector()
    const degraded = {
      ...await dependencies().persistOutput({
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        attemptId: ATTEMPT_ID,
        job: completedJob(),
        videoBytes: Buffer.from('mp4'),
      }),
      verification: {
        checkPassed: false,
        goldenVerified: true,
        goldenCheckCount: 2,
        outcome: 'degraded' as const,
      },
    }
    await expect(runWebsiteVideo(runInput(), dependencies({
      stages,
      persistOutput: vi.fn(async () => degraded),
    }))).rejects.toMatchObject({ code: 'WEBSITE_VERIFICATION_FAILED' })

    expect(stages.block).toHaveBeenCalledWith(PROJECT_ID, degraded)
    expect(stages.complete).not.toHaveBeenCalled()
  })

  it('projects a safe failure when the terminal projection fails afterwards', async () => {
    const projectionFailure = new Error('projection failed')
    const stages = stageProjector()
    stages.complete.mockRejectedValueOnce(projectionFailure)
    await expect(runWebsiteVideo(runInput(), dependencies({
      stages,
    }))).rejects.toBe(projectionFailure)

    expect(stages.fail).toHaveBeenCalledWith(
      PROJECT_ID,
      'export',
      'WEBSITE_EXECUTION_FAILED',
    )
  })

})

function runInput() {
  return {
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    attemptId: ATTEMPT_ID,
  }
}

function dependencies(
  overrides: Partial<WebsiteExecutionDependencies> = {},
): WebsiteExecutionDependencies {
  return {
    loadProject: async () => ({
      title: '产品主页',
      source: {
        schemaVersion: 1,
        kind: 'website',
        url: 'https://example.com/product?campaign=private',
        durationSec: 30,
        quality: 'standard',
        visualTheme: 'dark',
      },
      sourceFingerprint: SOURCE_HASH,
      soundEffects: 'procedural',
    }),
    engine: {
      start: vi.fn(async () => ({ reused: false, job: completedJob() })),
      getJob: vi.fn(),
      downloadVideo: vi.fn(async () => Buffer.from('mp4')),
    },
    stages: stageProjector(),
    persistOutput: vi.fn(async () => ({
      artifactId: 'artifact-1',
      soundEffectsManifestArtifactId: 'manifest-1',
      storageKey: 'website/output.mp4',
      contentHash: 'b'.repeat(64),
      sizeBytes: 24,
      durationSec: 29,
      durationSource: 'output' as const,
      elapsedSec: 29,
      verification: {
        checkPassed: true,
        goldenVerified: true,
        goldenCheckCount: 2,
        outcome: 'passed' as const,
      },
    })),
    nowMs: () => 0,
    sleep: vi.fn(async () => undefined),
    pollIntervalMs: 1,
    timeoutMs: 1_000,
    ...overrides,
  }
}

function stageProjector() {
  return {
    progress: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    block: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  }
}

function completedJob(overrides: Partial<WebsiteEngineJob> = {}): WebsiteEngineJob {
  return {
    id: 'job-1',
    requestId: `website:${PROJECT_ID}:${ATTEMPT_ID}`,
    origin: 'https://example.com',
    status: 'done',
    phase: 'done',
    durationSec: 29,
    durationSource: 'output',
    elapsedSec: 29,
    checkPassed: true,
    goldenVerified: true,
    goldenCheckCount: 2,
    soundEffects: {
      mode: 'procedural',
      status: 'applied',
      generatorVersion: 'procedural-sfx/1.0.0',
      cueCount: 2,
      timingHash: 'c'.repeat(64),
      cuePlanHash: 'd'.repeat(64),
      waveformHashes: ['e'.repeat(64), 'f'.repeat(64)],
    },
    hasVideo: true,
    videoUrl: '/video',
    failure: null,
    ...overrides,
  }
}
