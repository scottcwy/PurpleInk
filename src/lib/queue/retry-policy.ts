import { and, eq, gte, sql } from 'drizzle-orm'
import { classifyWorkflowError } from '@/features/canvas/workflow-error'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import { taskAttempts } from '@/lib/db/schema/index'
import { queueFingerprint } from './attempt-checkpoint'

/** 同 run 内自动重试上限：attemptNo 最多到 MAX_AUTO_RETRIES + 1。 */
export const MAX_AUTO_RETRIES = 2
/** 重试预算的统计窗口：同 fingerprint 在窗口内的 failed attempt 计入预算。 */
export const RETRY_WINDOW_MS = 30 * 60_000
/** 窗口内失败达到该值即视为毒任务，拒绝再次入队。 */
export const MAX_FAILURES_IN_WINDOW = 5
export const BASE_RETRY_DELAY_MS = 5000

/** 闸门报文：含「已暂停重试」独有词供 workflow-error 归类，并给出用户出口。 */
export const RETRY_BUDGET_EXHAUSTED_MESSAGE =
  '该环节在 30 分钟内已失败 5 次，已暂停重试；可稍后再试、修复配置或选择跳过'

/** 与 ArtifactValidationError 同款约定：canvas 只按类型名判定，不反向依赖队列层。 */
export class RetryBudgetExhaustedError extends Error {
  override readonly name = 'RetryBudgetExhaustedError'

  constructor() {
    super(RETRY_BUDGET_EXHAUSTED_MESSAGE)
  }
}

/** 指数退避 + ±20% 抖动：5000 * 2^attemptNo，抖动避免同批失败齐点唤醒。 */
export function backoffMs(attemptNo: number): number {
  const base = BASE_RETRY_DELAY_MS * 2 ** attemptNo
  return Math.round(base + (Math.random() * 2 - 1) * 0.2 * base)
}

/**
 * 是否值得自动重试：retryable 判定必须走 classifyWorkflowError（禁止在此
 * 用字符串 includes 自判），且不超出同 run 的自动重试上限。stage 只影响
 * 未识别报文的兜底类别，队列侧默认 QUEUE。
 */
export function shouldAutoRetry(
  failure: unknown,
  attemptNo: number,
  stage = 'QUEUE'
): boolean {
  if (attemptNo > MAX_AUTO_RETRIES) return false
  const error = typeof failure === 'string' ? new Error(failure) : failure
  return classifyWorkflowError(error, { stage }).retryable
}

/** 窗口内同 fingerprint 的 failed attempt 数；按 completedAt（失败落定时刻）统计。 */
export async function countRecentFailures(
  db: Db,
  workspaceId: string,
  fingerprint: string
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(taskAttempts)
    .where(
      and(
        eq(taskAttempts.workspaceId, workspaceId),
        eq(taskAttempts.fingerprint, fingerprint),
        eq(taskAttempts.status, 'failed'),
        gte(
          taskAttempts.completedAt,
          sql`now() - make_interval(secs => ${RETRY_WINDOW_MS / 1000})`
        )
      )
    )
  return row?.count ?? 0
}

/**
 * 入队前的毒任务闸门：预算耗尽即抛 RetryBudgetExhaustedError。只拦「再次
 * 入队」，不影响正在执行的 attempt。入队发生在请求上下文内，归属取自当前会话。
 */
export async function assertEnqueueRetryBudget(
  kind: string,
  payload: Record<string, unknown>
): Promise<void> {
  const failures = await countRecentFailures(
    await getDb(),
    currentWorkspaceId(),
    queueFingerprint(kind, payload)
  )
  if (failures >= MAX_FAILURES_IN_WINDOW) {
    throw new RetryBudgetExhaustedError()
  }
}
