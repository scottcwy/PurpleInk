import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * workspaceId 的单一读取口（PLAN-002 §1.2）。
 *
 * 为什么用 AsyncLocalStorage 而不是显式参数透传：透传更纯，但要改 29 个生产文件的
 * 函数签名与全部调用链，diff 规模会盖过真正的认证逻辑，评审失去信号。
 *
 * ALS 的代价是「忘记建立上下文」，因此 `currentWorkspaceId()` **没有 fallback**：
 * 无上下文即抛错。这把遗漏变成立即可见的失败，而不是静默跨账户串号。
 */
export interface AuthContext {
  userId: string
  workspaceId: string
}

/**
 * 队列消费者没有请求上下文，用它占 userId 位；它**不是** `users` 表里的行，
 * 不参与任何 FK。真实归属由 attempt 行自己的 workspaceId 决定（§5.3）。
 */
export const SYSTEM_USER_ID = 'system:queue'

const globalStore = globalThis as unknown as {
  __cvcAuthContextStorage?: AsyncLocalStorage<AuthContext>
}

function storage(): AsyncLocalStorage<AuthContext> {
  globalStore.__cvcAuthContextStorage ??= new AsyncLocalStorage<AuthContext>()
  return globalStore.__cvcAuthContextStorage
}

/** 在给定归属上下文内执行；嵌套调用以最内层为准。 */
export function runInAuthContext<T>(context: AuthContext, operation: () => T): T {
  if (!context.workspaceId) throw new Error('auth context requires workspaceId')
  if (!context.userId) throw new Error('auth context requires userId')
  return storage().run(context, operation)
}

export function currentAuthContext(): AuthContext | undefined {
  return storage().getStore()
}

/**
 * 当前请求 / 当前作业的 workspaceId。**无上下文时抛错，不回落到
 * `LOCAL_WORKSPACE_ID`** —— 静默串号比抛错危险得多（§10 禁区 5）。
 */
export function currentWorkspaceId(): string {
  const context = storage().getStore()
  if (!context) {
    throw new Error(
      'workspace context is not established: wrap the call in runInAuthContext()',
    )
  }
  return context.workspaceId
}

export function currentUserId(): string {
  const context = storage().getStore()
  if (!context) {
    throw new Error(
      'workspace context is not established: wrap the call in runInAuthContext()',
    )
  }
  return context.userId
}
