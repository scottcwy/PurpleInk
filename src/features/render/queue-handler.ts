import 'server-only'
import { z } from 'zod'
import { transitionNodeStatus } from '@/features/canvas'
import { queue as defaultQueue, type QueueAdapter } from '@/lib/queue'
import { storage } from '@/lib/storage'
import { assertRenderAdmission } from './admission'
import { openFrameCapture } from './frame-capture'
import { RenderRepository } from './repository'
import { HyperframesRenderer, type Renderer } from './renderer'
import type { RenderJob } from './types'
import { advancePipeline } from '@/features/director/advance'

const renderJobPayloadSchema = z
  .object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
  })
  .strict()

export type RenderShotInput = z.infer<typeof renderJobPayloadSchema>

interface HandlerRepository {
  loadRenderContext(projectId: string, nodeId: string): Promise<RenderJob>
  recordRenderError(nodeId: string, error: unknown): Promise<void>
}

interface HandlerDependencies {
  repository: HandlerRepository
  transitionNodeStatus: typeof transitionNodeStatus
  renderer: Renderer
  advancePipeline: (
    projectId: string,
    completedNodeId: string
  ) => Promise<unknown>
}

interface EnqueueDependencies {
  queue: QueueAdapter
  loadAdmissionContext(
    projectId: string,
    nodeId: string
  ): RenderJob | Promise<RenderJob>
  assertAdmission(job: RenderJob): Promise<void>
  transitionNodeStatus: typeof transitionNodeStatus
  recordRenderError(nodeId: string, error: unknown): Promise<void>
}

export function registerRenderShotHandler(
  targetQueue: QueueAdapter = defaultQueue,
  dependencies?: HandlerDependencies
): void {
  targetQueue.register('render-shot', async (job) => {
    const resolved = dependencies ?? createHandlerDependencies()
    const payload = renderJobPayloadSchema.parse(job.payload)
    await resolved.transitionNodeStatus(payload.nodeId, 'running')
    try {
      const context = await resolved.repository.loadRenderContext(
        payload.projectId,
        payload.nodeId
      )
      await resolved.renderer.render(context)
      await resolved.transitionNodeStatus(payload.nodeId, 'success')
      await advanceWithoutMasking(
        resolved.advancePipeline,
        payload.projectId,
        payload.nodeId
      )
    } catch (error) {
      await failRender(payload.nodeId, error, resolved)
      throw error
    }
  })
}

export async function enqueueRenderShot(
  input: RenderShotInput,
  dependencies?: EnqueueDependencies
): Promise<string> {
  const resolved = dependencies ?? createEnqueueDependencies()
  const payload = renderJobPayloadSchema.parse(input)
  const job = await resolved.loadAdmissionContext(
    payload.projectId,
    payload.nodeId
  )
  await resolved.assertAdmission(job)
  await resolved.transitionNodeStatus(payload.nodeId, 'pending')
  try {
    return await resolved.queue.enqueue('render-shot', payload, {
      projectId: payload.projectId,
      nodeId: payload.nodeId,
    })
  } catch (error) {
    await compensateEnqueueFailure(payload.nodeId, error, resolved)
    throw error
  }
}

function createHandlerDependencies(): HandlerDependencies {
  return {
    repository: new RenderRepository(),
    transitionNodeStatus,
    renderer: new HyperframesRenderer(),
    advancePipeline,
  }
}

async function advanceWithoutMasking(
  advance: HandlerDependencies['advancePipeline'],
  projectId: string,
  nodeId: string
): Promise<void> {
  try {
    await advance(projectId, nodeId)
  } catch (error) {
    console.error('[render] 下游自动推进失败', {
      projectId,
      nodeId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function createEnqueueDependencies(): EnqueueDependencies {
  const repository = new RenderRepository()
  return {
    queue: defaultQueue,
    loadAdmissionContext: (projectId, nodeId) =>
      repository.loadRenderAdmissionContext(projectId, nodeId),
    assertAdmission: (job) =>
      assertRenderAdmission(job, { storage, openFrameCapture }),
    transitionNodeStatus,
    recordRenderError: (nodeId, error) =>
      repository.recordRenderError(nodeId, error),
  }
}

function failRender(
  nodeId: string,
  error: unknown,
  dependencies: Pick<HandlerDependencies, 'transitionNodeStatus' | 'repository'>
): Promise<void> {
  return compensateFailure(nodeId, error, dependencies)
}

async function compensateFailure(
  nodeId: string,
  error: unknown,
  dependencies: Pick<HandlerDependencies, 'transitionNodeStatus' | 'repository'>
): Promise<void> {
  const cleanupErrors: unknown[] = []
  try {
    await dependencies.transitionNodeStatus(nodeId, 'failed')
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
  }
  try {
    await dependencies.repository.recordRenderError(nodeId, error)
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError([error, ...cleanupErrors], '渲染失败补偿不完整')
  }
}

function compensateEnqueueFailure(
  nodeId: string,
  error: unknown,
  dependencies: EnqueueDependencies
): Promise<void> {
  return compensateEnqueueFailureAsync(nodeId, error, dependencies)
}

async function compensateEnqueueFailureAsync(
  nodeId: string,
  error: unknown,
  dependencies: EnqueueDependencies
): Promise<void> {
  const cleanupErrors: unknown[] = []
  for (const status of ['running', 'failed'] as const) {
    try {
      await dependencies.transitionNodeStatus(nodeId, status)
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
  }
  try {
    await dependencies.recordRenderError(nodeId, error)
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [error, ...cleanupErrors],
      '渲染作业入队失败且补偿不完整'
    )
  }
}
