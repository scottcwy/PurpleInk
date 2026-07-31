import 'server-only'
import {
  captureNodeInputFingerprint,
  transitionNodeStatus,
} from '@/features/canvas'
import { assertProjectWorkflowSupported } from '@/features/projects/project-compatibility'
import {
  AutomaticAdvanceDisabledError,
  assertEnqueueRetryBudget,
  queue as defaultQueue,
  type QueueAdapter,
} from '@/lib/queue'
import { storage } from '@/lib/storage'
import { assertRenderAdmission } from './admission'
import { openFrameCapture } from './frame-capture'
import {
  compensateEnqueueFailure,
  failFabricate,
  failRender,
  type RenderFailureRepository,
} from './queue-failure-compensation'
import { RenderRepository } from './repository'
import { HyperframesRenderer, type Renderer } from './renderer'
import {
  renderJobPayloadSchema,
  type RenderShotInput,
} from './render-job-payload'
import type { RenderAdmissionContext, RenderJob } from './types'
import { advancePipeline } from '@/features/director/advance'
import { fabricateShot } from '@/features/director/fabricate'

interface HandlerRepository extends RenderFailureRepository {
  hasFabricateArtifact(projectId: string, nodeId: string): Promise<boolean>
  loadRenderContext(projectId: string, nodeId: string): Promise<RenderJob>
  recordOutputHash?(nodeId: string, contentHash: string): Promise<void>
}

interface HandlerDependencies {
  repository: HandlerRepository
  transitionNodeStatus: typeof transitionNodeStatus
  renderer: Renderer
  fabricateShot: (
    projectId: string,
    nodeId: string,
    attemptId: string,
    revisionBrief?: string,
  ) => Promise<void>
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
  captureInputFingerprint?(nodeId: string): Promise<unknown>
  transitionNodeStatus: typeof transitionNodeStatus
  /** 毒任务闸门（可选）：重试预算耗尽时拒绝再次入队。 */
  assertRetryBudget?(kind: string, payload: Record<string, unknown>): Promise<void>
  recordRenderError(nodeId: string, error: unknown): Promise<void>
  rejectFabricateArtifact?(
    projectId: string,
    nodeId: string,
    sourceKey: string,
  ): Promise<void>
}

export function registerRenderShotHandler(
  targetQueue: QueueAdapter = defaultQueue,
  dependencies?: HandlerDependencies
): void {
  targetQueue.register('render-shot', async (job) => {
    const resolved = dependencies ?? createHandlerDependencies()
    const payload = renderJobPayloadSchema.parse(job.payload)
    job.signal?.throwIfAborted()
    await resolved.transitionNodeStatus(payload.nodeId, 'running')
    try {
      if (
        payload.regenerateSource
        || !(await resolved.repository.hasFabricateArtifact(payload.projectId, payload.nodeId))
      ) {
        const args = [payload.projectId, payload.nodeId, job.id] as const
        await (payload.revisionBrief
          ? resolved.fabricateShot(...args, payload.revisionBrief)
          : resolved.fabricateShot(...args))
      }
      job.signal?.throwIfAborted()
    } catch (error) {
      await failFabricate(payload.nodeId, error, resolved)
      throw error
    }
    let sourceKey: string | undefined
    try {
      const context = await resolved.repository.loadRenderContext(
        payload.projectId,
        payload.nodeId
      )
      sourceKey = context.htmlKey
      const result = await resolved.renderer.render({
        ...context,
        ...(payload.forceRender ? { forceRender: true } : {}),
      })
      job.signal?.throwIfAborted()
      await resolved.repository.recordOutputHash?.(
        payload.nodeId,
        result.contentHash
      )
      job.signal?.throwIfAborted()
      await resolved.transitionNodeStatus(payload.nodeId, 'success')
      await advanceWithoutMasking(
        resolved.advancePipeline,
        payload.projectId,
        payload.nodeId
      )
    } catch (error) {
      await failRender(
        payload.projectId,
        payload.nodeId,
        sourceKey,
        error,
        resolved,
      )
      throw error
    }
  })
}

export async function enqueueRenderShot(
  input: RenderShotInput,
  dependencies?: EnqueueDependencies,
  options: { requireAutomaticAdvance?: boolean } = {},
): Promise<string> {
  const payload = renderJobPayloadSchema.parse(input)
  if (!dependencies) await assertProjectWorkflowSupported(payload.projectId)
  const resolved = dependencies ?? createEnqueueDependencies()
  let pendingSet = false
  let sourceKey: string | undefined
  try {
    const admission = await resolved.loadAdmissionContext(
      payload.projectId,
      payload.nodeId
    )
    if (admission.job && !payload.regenerateSource) {
      sourceKey = admission.job.htmlKey
      await resolved.assertAdmission(admission.job)
    }
    await resolved.captureInputFingerprint?.(payload.nodeId)
    await resolved.transitionNodeStatus(payload.nodeId, 'pending')
    pendingSet = true
    // 闸门在 try 内：预算耗尽走既有补偿链，落节点 failed + renderError 投影。
    await resolved.assertRetryBudget?.('render-shot', payload)
    return await resolved.queue.enqueue('render-shot', payload, {
      projectId: payload.projectId,
      nodeId: payload.nodeId,
      ...(options.requireAutomaticAdvance
        ? { requireAutomaticAdvance: true }
        : {}),
      reuseActiveAttempt: true,
    })
  } catch (error) {
    if (error instanceof AutomaticAdvanceDisabledError && pendingSet) {
      await resolved.transitionNodeStatus(
        payload.nodeId,
        'cancelled',
        { idempotent: true },
      )
      throw error
    }
    await compensateEnqueueFailure(
      payload.projectId,
      payload.nodeId,
      sourceKey,
      pendingSet,
      error,
      resolved,
    )
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
    captureInputFingerprint: captureNodeInputFingerprint,
    transitionNodeStatus,
    assertRetryBudget: assertEnqueueRetryBudget,
    recordRenderError: (nodeId, error) =>
      repository.recordRenderError(nodeId, error),
    rejectFabricateArtifact: (projectId, nodeId, sourceKey) =>
      repository.rejectFabricateArtifact(projectId, nodeId, sourceKey),
  }
}
