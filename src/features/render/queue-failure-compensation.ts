import 'server-only'
import { transitionNodeStatus } from '@/features/canvas'
import { isRenderSourceContractError } from './admission'

export interface RenderFailureRepository {
  recordRenderError(nodeId: string, error: unknown): Promise<void>
  rejectFabricateArtifact?(
    projectId: string,
    nodeId: string,
    sourceKey: string,
  ): Promise<void>
  recordStageError?(
    nodeId: string,
    stage: 'FABRICATE',
    error: unknown,
  ): Promise<void>
}

export interface RenderFailureDependencies {
  repository: RenderFailureRepository
  transitionNodeStatus: typeof transitionNodeStatus
}

export interface EnqueueFailureDependencies {
  transitionNodeStatus: typeof transitionNodeStatus
  recordRenderError(nodeId: string, error: unknown): Promise<void>
  rejectFabricateArtifact?(
    projectId: string,
    nodeId: string,
    sourceKey: string,
  ): Promise<void>
}

/** FABRICATE 失败只写 Director 错误，不写 renderError。 */
export async function failFabricate(
  nodeId: string,
  error: unknown,
  dependencies: RenderFailureDependencies,
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
      error,
    )
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
  }
  throwCleanupFailure(error, cleanupErrors, 'HTML 生成失败补偿不完整')
}

export async function failRender(
  projectId: string,
  nodeId: string,
  sourceKey: string | undefined,
  error: unknown,
  dependencies: RenderFailureDependencies,
): Promise<void> {
  const cleanupErrors: unknown[] = []
  await rejectFailedSource(
    projectId,
    nodeId,
    sourceKey,
    error,
    dependencies.repository,
    cleanupErrors,
  )
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
  throwCleanupFailure(error, cleanupErrors, '渲染失败补偿不完整')
}

/**
 * 入队失败必须落成节点 failed + renderError。admission 发生在 pending 之前时，
 * 补齐 idle -> pending -> running -> failed；队列写入失败则从 pending 开始。
 */
export async function compensateEnqueueFailure(
  projectId: string,
  nodeId: string,
  sourceKey: string | undefined,
  pendingSet: boolean,
  error: unknown,
  dependencies: EnqueueFailureDependencies,
): Promise<void> {
  const cleanupErrors: unknown[] = []
  await rejectFailedSource(
    projectId,
    nodeId,
    sourceKey,
    error,
    dependencies,
    cleanupErrors,
  )
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
  throwCleanupFailure(error, cleanupErrors, '渲染作业入队失败且补偿不完整')
}

async function rejectFailedSource(
  projectId: string,
  nodeId: string,
  sourceKey: string | undefined,
  error: unknown,
  dependencies: Pick<RenderFailureRepository, 'rejectFabricateArtifact'>,
  cleanupErrors: unknown[],
): Promise<void> {
  if (
    !sourceKey ||
    !isRenderSourceContractError(error) ||
    !dependencies.rejectFabricateArtifact
  ) {
    return
  }
  try {
    await dependencies.rejectFabricateArtifact(projectId, nodeId, sourceKey)
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
  }
}

function throwCleanupFailure(
  error: unknown,
  cleanupErrors: unknown[],
  message: string,
): void {
  if (cleanupErrors.length > 0) {
    throw new AggregateError([error, ...cleanupErrors], message)
  }
}
