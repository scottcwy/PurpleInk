import type { WorkspaceConcurrencyProjection } from '@/features/ai/workspace-concurrency-projection'
import type { PositionedCanvasNode } from '@/features/canvas'
import type { ProjectExecutionSnapshot } from '@/features/projects'

export interface QueueCounts {
  completed: number
  active: number
  waiting: number
  failed: number
  total: number
}

/** 从画布节点真值派生底部队列条的四类计数（纯投影，不发明状态）。 */
export function deriveQueueCounts(
  liveNodes: readonly PositionedCanvasNode[],
): QueueCounts {
  return {
    completed: liveNodes.filter(({ status }) => status === 'success').length,
    active: liveNodes.filter(
      ({ status, executionNotice }) =>
        (status === 'pending' || status === 'running') && !executionNotice,
    ).length,
    waiting: liveNodes.filter(
      ({ executionNotice }) => executionNotice != null,
    ).length,
    failed: liveNodes.filter(({ status }) => status === 'failed').length,
    total: liveNodes.length,
  }
}

/** 队列条标签：website 显示数据库确认的阶段数，script/audio 投影套餐并发。 */
export function queueBarLabel(
  execution: ProjectExecutionSnapshot,
  concurrency: WorkspaceConcurrencyProjection,
): string {
  if (execution.workflowKind === 'website') {
    const succeeded = execution.stages.filter(
      (stage) => stage.state === 'succeeded',
    ).length
    return `已完成 ${succeeded}/6 阶段`
  }
  return `套餐并发 ${concurrency.active}/${concurrency.limit} · ${concurrency.waiting} 个分镜排队`
}
