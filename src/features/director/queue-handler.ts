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
  assertEnqueueRetryBudget,
  queue as defaultQueue,
  type QueueAdapter,
} from '@/lib/queue'
import { DirectorRuntimeRepository } from './runtime-repository'
import { runStage as defaultRunStage } from './stage-runner'
import { PIPELINE_STAGES, type PipelineStage } from './types'

const directorStageJobSchema = z
  .object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    stage: z.enum(PIPELINE_STAGES),
  })
  .strict()

export type DirectorStageJobInput = z.infer<typeof directorStageJobSchema>

type RunStage = (
  projectId: string,
  nodeId: string,
  stage: PipelineStage
) => Promise<void>

interface EnqueueDependencies {
  queue: QueueAdapter
  assertEnqueueable(input: DirectorStageJobInput): Promise<void>
  captureInputFingerprint?(nodeId: string): Promise<unknown>
  transitionNodeStatus: typeof transitionNodeStatus
  /** 毒任务闸门（可选）：重试预算耗尽时拒绝再次入队。 */
  assertRetryBudget?(kind: string, payload: Record<string, unknown>): Promise<void>
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
    await runStage(payload.projectId, payload.nodeId, payload.stage)
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
  dependencies?: EnqueueDependencies
): Promise<string> {
  const payload = directorStageJobSchema.parse(input)
  if (!dependencies) await assertProjectWorkflowSupported(payload.projectId)
  const resolved = dependencies ?? (await createDefaultEnqueueDependencies())
  await resolved.assertEnqueueable(payload)
  await resolved.captureInputFingerprint?.(payload.nodeId)
  await resolved.transitionNodeStatus(payload.nodeId, 'pending')
  try {
    // 闸门在 try 内：预算耗尽走既有补偿链，落节点 failed + directorError 投影。
    await resolved.assertRetryBudget?.('director-stage', payload)
    return await resolved.queue.enqueue('director-stage', payload, {
      projectId: payload.projectId,
      nodeId: payload.nodeId,
    })
  } catch (error) {
    await compensateEnqueueFailure(payload, error, resolved)
    throw error
  }
}

async function createDefaultEnqueueDependencies(): Promise<EnqueueDependencies> {
  const repository = new DirectorRuntimeRepository(await getDb(), storage)
  return {
    queue: defaultQueue,
    assertEnqueueable: (input) =>
      repository.assertEnqueueable(input.projectId, input.nodeId, input.stage),
    captureInputFingerprint: captureNodeInputFingerprint,
    transitionNodeStatus,
    assertRetryBudget: assertEnqueueRetryBudget,
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
