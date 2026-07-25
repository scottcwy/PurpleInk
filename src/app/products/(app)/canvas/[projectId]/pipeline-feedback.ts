import type { PipelineControlResult } from './canvas-action-api'

export interface PipelineFeedback {
  variant: 'success' | 'error'
  title: string
  body: string
}

export function describePipelineResult(
  result: PipelineControlResult
): PipelineFeedback {
  const enqueued = result.enqueuedNodeIds?.length ?? 0
  const failed = result.failedNodeIds?.length ?? 0
  if (failed > 0) {
    return {
      variant: 'error',
      title: '工作流已启动，但有节点入队失败',
      body: `已入队 ${enqueued} 个节点，失败 ${failed} 个节点。`,
    }
  }
  return result.autopilot
    ? {
        variant: 'success',
        title: '工作流已启动',
        body: `已入队 ${enqueued} 个节点。`,
      }
    : {
        variant: 'success',
        title: '已停止自动推进',
        body: '已入队作业不会被伪装为已取消。',
      }
}
