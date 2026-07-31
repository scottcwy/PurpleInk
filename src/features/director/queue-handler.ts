import 'server-only'
import { z } from 'zod'
import {
  captureNodeInputFingerprint,
  transitionNodeStatus,
} from '@/features/canvas'
import { assertProjectWorkflowSupported } from '@/features/projects/project-compatibility'
import { getDb } from '@/lib/db/client'
import { storage } from '@/lib/storage'
import {
  AutomaticAdvanceDisabledError,
  assertEnqueueRetryBudget,
  queue as defaultQueue,
  type QueueAdapter,
  type QueueEnqueueReceipt,
} from '@/lib/queue'
import { DirectorRuntimeRepository } from './runtime-repository'
import { assertDirectorBillingAvailable } from './pi-provider'
import { runStage as defaultRunStage } from './stage-runner'
import { PIPELINE_STAGES, type PipelineStage } from './types'

const directorStageJobSchema = z
  .object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    stage: z.enum(PIPELINE_STAGES),
    finalArtifactHash: z.string().length(64).optional(),
  })
  .strict()

export type DirectorStageJobInput = z.infer<typeof directorStageJobSchema>

type RunStage = (
  projectId: string,
  nodeId: string,
  stage: PipelineStage,
  attemptId?: string,
  signal?: AbortSignal,
) => Promise<void>

interface EnqueueDependencies {
  queue: QueueAdapter
  assertEnqueueable(
    input: DirectorStageJobInput,
    options?: { allowPending?: boolean }
  ): Promise<void>
  captureInputFingerprint?(nodeId: string): Promise<unknown>
  transitionNodeStatus: typeof transitionNodeStatus
  /** 毒任务闸门（可选）：重试预算耗尽时拒绝再次入队。 */
  assertRetryBudget?(kind: string, payload: Record<string, unknown>): Promise<void>
  assertBillingAvailable?(input: DirectorStageJobInput): Promise<void>
  recordStageError(
    nodeId: string,
    stage: PipelineStage,
    error: unknown
  ): Promise<void>
}

export function registerDirectorStageHandler(
  targetQueue: QueueAdapter = defaultQueue,
  runStage: RunStage = defaultRunStage
): void {
  targetQueue.register('director-stage', async (job) => {
    const payload = directorStageJobSchema.parse(job.payload)
    job.signal?.throwIfAborted()
    await runStage(
      payload.projectId,
      payload.nodeId,
      payload.stage,
      job.id,
      job.signal,
    )
    job.signal?.throwIfAborted()
  })
}

export function startDirectorQueue(
  targetQueue: QueueAdapter = defaultQueue,
  runStage: RunStage = defaultRunStage
): void {
  registerDirectorStageHandler(targetQueue, runStage)
  targetQueue.start()
}

export async function enqueueDirectorStage(
  input: DirectorStageJobInput,
  dependencies?: EnqueueDependencies,
  options: { preservePending?: boolean } = {}
): Promise<string> {
  return (await enqueueDirectorStageWithReceipt(input, dependencies, options))
    .attemptId
}

export async function enqueueDirectorStageWithReceipt(
  input: DirectorStageJobInput,
  dependencies?: EnqueueDependencies,
  options: { preservePending?: boolean } = {},
): Promise<QueueEnqueueReceipt> {
  const payload = directorStageJobSchema.parse(input)
  if (!dependencies) await assertProjectWorkflowSupported(payload.projectId)
  const resolved = dependencies ?? (await createDefaultEnqueueDependencies())
  await resolved.assertEnqueueable(payload, {
    allowPending: options.preservePending === true,
  })
  await resolved.captureInputFingerprint?.(payload.nodeId)
  if (!options.preservePending) {
    await resolved.transitionNodeStatus(
      payload.nodeId,
      'pending',
      { idempotent: true },
    )
  }
  try {
    // 闸门在 try 内：预算耗尽走既有补偿链，落节点 failed + directorError 投影。
    await resolved.assertRetryBudget?.('director-stage', payload)
    await resolved.assertBillingAvailable?.(payload)
    const enqueueOptions = {
      projectId: payload.projectId,
      nodeId: payload.nodeId,
      requireAutomaticAdvance: true,
      reuseActiveAttempt: true,
    }
    if (resolved.queue.enqueueWithReceipt) {
      return await resolved.queue.enqueueWithReceipt(
        'director-stage',
        payload,
        enqueueOptions,
      )
    }
    return {
      attemptId: await resolved.queue.enqueue(
        'director-stage',
        payload,
        enqueueOptions,
      ),
      status: 'queued',
      reused: false,
    }
  } catch (error) {
    if (error instanceof AutomaticAdvanceDisabledError) {
      await resolved.transitionNodeStatus(
        payload.nodeId,
        'cancelled',
        { idempotent: true },
      )
      throw error
    }
    await compensateEnqueueFailure(payload, error, resolved)
    throw error
  }
}

async function createDefaultEnqueueDependencies(): Promise<EnqueueDependencies> {
  const repository = new DirectorRuntimeRepository(await getDb(), storage)
  return {
    queue: defaultQueue,
    assertEnqueueable: (input, options) =>
      repository.assertEnqueueable(
        input.projectId,
        input.nodeId,
        input.stage,
        options?.allowPending
      ),
    captureInputFingerprint: captureNodeInputFingerprint,
    transitionNodeStatus,
    assertRetryBudget: assertEnqueueRetryBudget,
    assertBillingAvailable: async (input) =>
      assertDirectorBillingAvailable({
        nodeType: await repository.loadNodeType(input.projectId, input.nodeId),
        stage: input.stage,
      }),
    recordStageError: (nodeId, stage, error) =>
      repository.recordStageError(nodeId, stage, error),
  }
}

async function compensateEnqueueFailure(
  payload: DirectorStageJobInput,
  error: unknown,
  dependencies: EnqueueDependencies
): Promise<void> {
  const cleanupErrors: unknown[] = []
  for (const status of ['running', 'failed'] as const) {
    try {
      await dependencies.transitionNodeStatus(payload.nodeId, status)
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
  }
  try {
    await dependencies.recordStageError(payload.nodeId, payload.stage, error)
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [error, ...cleanupErrors],
      `Director 作业入队失败且补偿不完整：${payload.stage}`
    )
  }
}
