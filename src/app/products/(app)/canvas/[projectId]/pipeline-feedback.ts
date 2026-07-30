import type { PipelineControlResult } from './canvas-action-api'

export interface PipelineFeedback {
  variant: 'info' | 'success' | 'error'
  title: string
  body: string
}

type PipelineFeedbackResult = Omit<PipelineControlResult, 'execution'> & {
  execution?: PipelineControlResult['execution']
}

export function describePipelineResult(
  result: PipelineFeedbackResult
): PipelineFeedback {
  const enqueued = result.enqueuedNodeIds?.length ?? 0
  const failed = result.failedNodeIds?.length ?? 0
  if (result.status === 'stopping') {
    return {
      variant: 'info',
      title: '正在停止项目',
      body: `仍有 ${result.remainingRunning ?? 0} 个作业正在安全退出。`,
    }
  }
  if (result.status === 'stopped') {
    const cancelled =
      (result.cancelledAttempts ?? 0)
      + (result.cancelledRuns ?? 0)
      + (result.cancelledTickets ?? 0)
      + (result.cancelledLeases ?? 0)
    return {
      variant: 'success',
      title: '项目已停止',
      body: cancelled > 0
        ? `已收敛 ${cancelled} 项排队或执行资源，可以安全删除项目。`
        : '项目没有仍在执行的作业，可以安全删除项目。',
    }
  }
  if (result.status === 'blocked') {
    return {
      variant: 'error',
      title: '工作流被阻塞',
      body:
        result.blockedNodes?.[0]?.message ??
        '项目尚未完成，但当前没有可执行节点。',
    }
  }
  if (result.status === 'complete') {
    return {
      variant: 'success',
      title: '工作流已完成',
      body: '全部节点已有有效产物。',
    }
  }
  if (result.status === 'reused') {
    return {
      variant: 'info',
      title: '已恢复现有任务',
      body: '没有创建重复任务，页面正在同步真实执行进度。',
    }
  }
  if (failed > 0) {
    return {
      variant: 'error',
      title: '工作流已启动，但有节点入队失败',
      body: `已入队 ${enqueued} 个节点，失败 ${failed} 个节点。`,
    }
  }
  return {
    variant: 'success',
    title: result.execution?.state === 'queued' ? '工作流已排队' : '工作流已启动',
    body: enqueued > 0
      ? `已入队 ${enqueued} 个节点。`
      : '后台任务已接收，页面正在同步真实执行状态。',
  }
}
