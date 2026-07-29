export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

export interface QueueJob {
  id: string
  /** attempt 行自身的归属；handler 在该 workspace 上下文内执行（PLAN-002 §5.3）。 */
  workspaceId: string
  /** 发起账号来自不可变 run 事实；历史无法归属的作业为 null。 */
  requestedByUserId?: string | null
  kind: string
  status: JobStatus
  payload: Record<string, unknown>
  attempts: number
  error?: string | null
}

/** 作业处理器：由各领域（如 render）注册。 */
export type JobHandler = (job: QueueJob) => Promise<void>

/** 按 job.kind 配额的并发通道；未列出的 kind 落入固定为 1 的兜底通道。 */
export type LaneQuotas = Partial<Record<string, number>>

/** N2 删除前的 legacy 队列适配器；持久状态映射到 PG run/attempt。 */
export interface QueueAdapter {
  enqueue(
    kind: string,
    payload?: Record<string, unknown>,
    opts?: { projectId?: string; nodeId?: string; requestedByUserId?: string },
  ): Promise<string>
  register(kind: string, handler: JobHandler): void
  start(lanes?: LaneQuotas): void
  stop(): void
}
