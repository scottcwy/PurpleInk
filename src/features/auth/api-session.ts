import 'server-only'
import { NextResponse } from 'next/server'
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

/**
 * 已登录才执行 handler，并在 handler 期间建立 workspace 上下文。
 *
 * 注意流式响应：`runInAuthContext` 只覆盖 handler 的同步/await 执行期，
 * `ReadableStream` 的 pull 回调发生在其**之后**。因此 SSE 路由必须在 handler 内
 * 就把 `workspaceId` 取出并闭包捕获，不能在流回调里再调 `currentWorkspaceId()`。
 */
export async function withApiSession(
  handler: (session: SessionOwner) => Promise<Response>,
): Promise<Response> {
  const session = await currentSession()
  if (!session) return unauthenticatedResponse()
  return runInAuthContext(
    { userId: session.userId, workspaceId: session.workspaceId },
    () => handler(session),
  )
}
