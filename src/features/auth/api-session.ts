import 'server-only'
import { NextResponse } from 'next/server'
import { recordApiAccess } from '@/features/admin/access-log'
import { readSessionToken } from '@/lib/auth/session-cookie'
import { runInAuthContext } from '@/lib/auth/workspace-context'
import { resolveSession, type SessionOwner } from './session'

/**
 * `/api/*` 的会话解析与归属上下文包裹（PLAN-002 §3.3）。
 *
 * API 不靠 `proxy.ts` 兜底：proxy 跑在每个请求上，连库会成为全站延迟与连接数
 * 压力；而且 API 需要的是 401 / 404 语义，不是 302。
 */

/** 未登录一律同一句类别文案，不带任何用户信息（§3.4）。 */
export const UNAUTHENTICATED_MESSAGE = '需要登录后才能访问'

export function unauthenticatedResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: UNAUTHENTICATED_MESSAGE },
    { status: 401 },
  )
}

/** 只读当前会话，不做拦截；供「登录态最小视图」这类公开端点使用。 */
export async function currentSession(): Promise<SessionOwner | null> {
  return resolveSession(await readSessionToken())
}

/** 出口计数选项：`routeGroup` 是不含 id/query 的稳定分组名（安全监控数据源）。 */
export interface ApiSessionOptions {
  routeGroup?: string
}

/**
 * 已登录才执行 handler，并在 handler 期间建立 workspace 上下文。
 *
 * 注意流式响应：`runInAuthContext` 只覆盖 handler 的同步/await 执行期，
 * `ReadableStream` 的 pull 回调发生在其**之后**。因此 SSE 路由必须在 handler 内
 * 就把 `workspaceId` 取出并闭包捕获，不能在流回调里再调 `currentWorkspaceId()`。
 *
 * 传入 `options.routeGroup` 时，无论 401 还是 handler 返回，都在出口对其 status
 * 归类做一次 fire-and-forget 计数（安全监控消费）；打点失败不影响响应。
 */
export async function withApiSession(
  handler: (session: SessionOwner) => Promise<Response>,
  options?: ApiSessionOptions,
): Promise<Response> {
  const session = await currentSession()
  if (!session) {
    const response = unauthenticatedResponse()
    if (options?.routeGroup) void recordApiAccess(options.routeGroup, response.status)
    return response
  }
  const response = await runInAuthContext(
    { userId: session.userId, workspaceId: session.workspaceId },
    () => handler(session),
  )
  if (options?.routeGroup) void recordApiAccess(options.routeGroup, response.status)
  return response
}

/**
 * 仅全局 admin 可执行 handler。非 admin 一律回 404 而不是 403：
 * 不向普通用户泄露 /api/admin 这层表面的存在（与未登录的 401 类别文案同思路）。
 */
export async function withAdminSession(
  handler: (session: SessionOwner) => Promise<Response>,
  options?: ApiSessionOptions,
): Promise<Response> {
  return withApiSession(async (session) => {
    if (session.role !== 'admin') {
      return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
    }
    return handler(session)
  }, options)
}
