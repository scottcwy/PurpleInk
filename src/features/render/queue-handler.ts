import 'server-only'
import { z } from 'zod'
import { transitionNodeStatus } from '@/features/canvas'
import { assertProjectWorkflowSupported } from '@/features/projects/project-compatibility'
import { queue as defaultQueue, type QueueAdapter } from '@/lib/queue'
import { storage } from '@/lib/storage'
import { assertRenderAdmission } from './admission'
import { openFrameCapture } from './frame-capture'
import { RenderRepository } from './repository'
import { HyperframesRenderer, type Renderer } from './renderer'
import type { RenderAdmissionContext, RenderJob } from './types'
import { advancePipeline } from '@/features/director/advance'
import { fabricateShot } from '@/features/director/fabricate'

const renderJobPayloadSchema = z
  .object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
  })
  .strict()

export type RenderShotInput = z.infer<typeof renderJobPayloadSchema>

interface HandlerRepository {
  hasFabricateArtifact(projectId: string, nodeId: string): Promise<boolean>
  loadRenderContext(projectId: string, nodeId: string): Promise<RenderJob>
  recordRenderError(nodeId: string, error: unknown): Promise<void>
  recordStageError?(
    nodeId: string,
    stage: 'FABRICATE',
    error: unknown
  ): Promise<void>
}

interface HandlerDependencies {
  repository: HandlerRepository
  transitionNodeStatus: typeof transitionNodeStatus
  renderer: Renderer
  fabricateShot: (projectId: string, nodeId: string) => Promise<void>
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
  ): RenderAdmissionContext | Promise<RenderAdmissionContext>
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
      if (!(await resolved.repository.hasFabricateArtifact(payload.projectId, payload.nodeId))) {
        await resolved.fabricateShot(payload.projectId, payload.nodeId)
      }
    } catch (error) {
      await failFabricate(payload.nodeId, error, resolved)
      throw error
    }
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
  const payload = renderJobPayloadSchema.parse(input)
  if (!dependencies) await assertProjectWorkflowSupported(payload.projectId)
  const resolved = dependencies ?? createEnqueueDependencies()
  let pendingSet = false
  try {
    const admission = await resolved.loadAdmissionContext(
      payload.projectId,
      payload.nodeId
    )
    if (admission.job) {
      await resolved.assertAdmission(admission.job)
    }
    await resolved.transitionNodeStatus(payload.nodeId, 'pending')
    pendingSet = true
    return await resolved.queue.enqueue('render-shot', payload, {
      projectId: payload.projectId,
      nodeId: payload.nodeId,
    })
  } catch (error) {
    await compensateEnqueueFailure(payload.nodeId, pendingSet, error, resolved)
    throw error
  }
}

function createHandlerDependencies(): HandlerDependencies {
  return {
    repository: new RenderRepository(),
    transitionNodeStatus,
    renderer: new HyperframesRenderer(),
    fabricateShot,
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

/**
 * FABRICATE 阶段失败只写 Director 错误，不写 renderError。即使失败发生在
 * Director context 加载阶段，也必须由这里补齐可见错误投影。
 */
async function failFabricate(
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
    await dependencies.repository.recordStageError?.(
      nodeId,
      'FABRICATE',
      error
    )
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [error, ...cleanupErrors],
      'HTML 生成失败补偿不完整'
    )
  }
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
  pendingSet: boolean,
  error: unknown,
  dependencies: EnqueueDependencies
): Promise<void> {
  return compensateEnqueueFailureAsync(nodeId, pendingSet, error, dependencies)
}

/**
 * 把一次入队失败落成节点 `failed` + `renderError`，不留给 `advance.ts` 的通用
 * `recordStageError` 兜底（那条路径只写 `directorError`、不转 `failed`，会让节点
 * 永久停在 `idle` 且 Inspector 因 `STREAMABLE` 只含 running/success/failed 而
 * 完全不展示任何错误信息）。
 *
 * 补偿路径必须匹配失败发生时节点的真实状态：若失败在 `pending` 转换之前
 * （admission 加载或预检阶段），节点仍是 `idle`，只能走 `idle -> pending ->
 * running -> failed`；若失败发生在队列写入阶段，节点已是 `pending`，走
 * `pending -> running -> failed`（原有行为，不变）。
 */
async function compensateEnqueueFailureAsync(
  nodeId: string,
  pendingSet: boolean,
  error: unknown,
  dependencies: EnqueueDependencies
): Promise<void> {
  const cleanupErrors: unknown[] = []
  const transitions = pendingSet
    ? (['running', 'failed'] as const)
    : (['pending', 'running', 'failed'] as const)
  for (const status of transitions) {
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
