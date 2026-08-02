import type { StageRunnerDependencies } from './stage-runner-contract'

export async function scheduleMediaWithoutMasking(
  schedule: NonNullable<StageRunnerDependencies['scheduleMediaNarration']>,
  input: {
    projectId: string
    nodeId: string
    attemptId?: string
    signal?: AbortSignal
  },
): Promise<void> {
  try {
    input.signal?.throwIfAborted()
    await schedule(input)
    input.signal?.throwIfAborted()
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason ?? error
    console.error('[director] 异步媒体入队失败', {
      projectId: input.projectId,
      nodeId: input.nodeId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function advanceWithoutMasking(
  advance: StageRunnerDependencies['advancePipeline'],
  projectId: string,
  nodeId: string,
  attemptId?: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    signal?.throwIfAborted()
    await advance(
      projectId,
      nodeId,
      attemptId ? { attemptId, signal } : undefined,
    )
    signal?.throwIfAborted()
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error
    console.error('[director] 下游自动推进失败', {
      projectId,
      nodeId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function transitionStageNode(
  transition: StageRunnerDependencies['transitionNodeStatus'],
  projectId: string,
  nodeId: string,
  status: 'running' | 'success' | 'failed',
  attemptId?: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  await transition(
    nodeId,
    status,
    attemptId
      ? { execution: { projectId, attemptId, signal } }
      : undefined,
  )
  signal?.throwIfAborted()
}
