import { describe, expect, it, vi } from 'vitest'
import type { ManagedWebsiteBillingInput } from './managed-billing'
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
  it('runs the engine inside managed billing and completes with the committed artifact', async () => {
    const completed = completedJob()
    const billingInputs: ManagedWebsiteBillingInput<unknown>[] = []
    const stages = stageProjector()
    const start = vi.fn(async () => ({ reused: false, job: completed }))
    const output = {
      artifactId: 'artifact-1',
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
      bill: async <T>(input: ManagedWebsiteBillingInput<T>): Promise<T> => {
        billingInputs.push(input as ManagedWebsiteBillingInput<unknown>)
        const invoked = await input.invoke()
        expect(input.completion(invoked)).toEqual({
          durationSec: 29,
          durationSource: 'output',
          outputHash: 'b'.repeat(64),
        })
        return invoked
      },
    }))

    expect(result).toEqual(output)
    expect(billingInputs[0]).toMatchObject({
      workspaceId: WORKSPACE_ID,
      attemptId: ATTEMPT_ID,
      invocationNo: 1,
      requestIdentity: SOURCE_HASH,
      maximumDurationSeconds: 30,
    })
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.com/product?campaign=private',
      name: '产品主页',
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

  it('settles real output usage before blocking a degraded delivery', async () => {
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
    const completion = vi.fn()

    await expect(runWebsiteVideo(runInput(), dependencies({
      stages,
      persistOutput: vi.fn(async () => degraded),
      bill: async <T>(input: ManagedWebsiteBillingInput<T>): Promise<T> => {
        const result = await input.invoke()
        completion(input.completion(result))
        return result
      },
    }))).rejects.toMatchObject({ code: 'WEBSITE_VERIFICATION_FAILED' })

    expect(completion).toHaveBeenCalledWith({
      durationSec: degraded.durationSec,
      durationSource: 'output',
      outputHash: degraded.contentHash,
    })
    expect(stages.block).toHaveBeenCalledWith(PROJECT_ID, degraded)
    expect(stages.complete).not.toHaveBeenCalled()
  })

  it('keeps real usage settled when the terminal projection fails afterwards', async () => {
    const projectionFailure = new Error('projection failed')
    const stages = stageProjector()
    stages.complete.mockRejectedValueOnce(projectionFailure)
    const settled = vi.fn()

    await expect(runWebsiteVideo(runInput(), dependencies({
      stages,
      bill: async <T>(input: ManagedWebsiteBillingInput<T>): Promise<T> => {
        const result = await input.invoke()
        settled(input.completion(result))
        return result
      },
    }))).rejects.toBe(projectionFailure)

    expect(settled).toHaveBeenCalledOnce()
    expect(stages.fail).toHaveBeenCalledWith(
      PROJECT_ID,
      'export',
      'WEBSITE_EXECUTION_FAILED',
    )
  })

  it('keeps the delivered artifact successful when final ledger settlement is deferred', async () => {
    const stages = stageProjector()
    const settlementFailure = new Error('settlement failed')
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const expected = await dependencies().persistOutput({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      attemptId: ATTEMPT_ID,
      job: completedJob(),
      videoBytes: Buffer.from('mp4'),
    })

    const result = await runWebsiteVideo(runInput(), dependencies({
      stages,
      persistOutput: vi.fn(async () => expected),
      bill: async <T>(input: ManagedWebsiteBillingInput<T>): Promise<T> => {
        await input.invoke()
        throw settlementFailure
      },
    }))

    expect(result).toEqual(expected)
    expect(stages.complete).toHaveBeenCalledWith(PROJECT_ID, expected)
    expect(stages.fail).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledWith(
      '[website-billing]',
      expect.stringContaining('WEBSITE_BILLING_SETTLEMENT_DEFERRED'),
    )
    report.mockRestore()
  })
})

function runInput() {
  return {
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    attemptId: ATTEMPT_ID,
    invocationNo: 1,
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
    }),
    engine: {
      start: vi.fn(async () => ({ reused: false, job: completedJob() })),
      getJob: vi.fn(),
      downloadVideo: vi.fn(async () => Buffer.from('mp4')),
    },
    stages: stageProjector(),
    bill: async <T>(input: ManagedWebsiteBillingInput<T>) => input.invoke(),
    persistOutput: vi.fn(async () => ({
      artifactId: 'artifact-1',
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
    hasVideo: true,
    videoUrl: '/video',
    failure: null,
    ...overrides,
  }
}
