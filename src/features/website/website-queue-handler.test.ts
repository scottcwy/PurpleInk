import { describe, expect, it, vi } from 'vitest'
import { QuotaExhaustedError } from '@/features/billing'
import { classifyWorkflowError } from '@/features/canvas'
import type { QueueAdapter, QueueJob } from '@/lib/queue'
import { activeWorkflowVersionFor } from '@/lib/workflow/project-workflow-registry'
import {
  registerWebsiteVideoHandler,
  runWebsiteVideoQueueJob,
  WEBSITE_BILLING_INVOCATION_NO,
} from './website-queue-handler'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const PROJECT_ID = '00000000-0000-4000-8000-000000000101'
const ATTEMPT_ID = '00000000-0000-4000-8000-000000000201'

describe('website video queue handler', () => {
  it('binds queue workspace and project attempt to the billing context', async () => {
    const run = vi.fn(async () => undefined)
    await runWebsiteVideoQueueJob(job(), run)
    expect(run).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      attemptId: ATTEMPT_ID,
      invocationNo: WEBSITE_BILLING_INVOCATION_NO,
    })
  })

  it('registers without starting or changing the queue', async () => {
    let handler: ((job: QueueJob) => Promise<void>) | undefined
    const queue = {
      register: vi.fn((kind: string, next) => {
        expect(kind).toBe('website-video')
        handler = next
      }),
    } as unknown as QueueAdapter
    const run = vi.fn(async () => undefined)
    registerWebsiteVideoHandler(queue, run)

    expect(handler).toBeDefined()
    await handler?.(job())
    expect(run).toHaveBeenCalledOnce()
  })

  it('marks a billed composite failure as terminal instead of spawning a charged retry', async () => {
    const run = vi.fn(async () => {
      throw new Error('temporary worker failure')
    })

    const execution = runWebsiteVideoQueueJob(job(), run)
    await expect(execution).rejects.toMatchObject({
      name: 'WebsiteVideoAttemptTerminalError',
      failureCode: 'WEBSITE_EXECUTION_FAILED',
      retryable: false,
    })
    await execution.catch((error: unknown) => {
      expect(classifyWorkflowError(error, { stage: 'QUEUE' })).toMatchObject({
        code: 'STAGE_FAILED',
        retryable: false,
      })
      expect(JSON.stringify(error)).toContain('网站介绍视频本次执行已安全终止')
      expect(JSON.stringify(error)).not.toContain('temporary worker failure')
    })
  })

  it('preserves the shared quota fault instead of relabeling it as a website failure', async () => {
    const quota = new QuotaExhaustedError('2026-08-27T00:00:00.000Z')
    await expect(runWebsiteVideoQueueJob(
      job(),
      vi.fn(async () => {
        throw quota
      }),
    )).rejects.toBe(quota)
  })
})

function job(): QueueJob {
  return {
    id: ATTEMPT_ID,
    workspaceId: WORKSPACE_ID,
    kind: 'website-video',
    status: 'running',
    payload: {
      projectId: PROJECT_ID,
      workflowVersion: activeWorkflowVersionFor('website'),
    },
    attempts: 1,
  }
}
