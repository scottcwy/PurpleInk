import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { readSessionToken } from '@/lib/auth/session-cookie'
import { runInAuthContext } from '@/lib/auth/workspace-context'
import { DEFAULT_POST_LOGIN_PATH, safeNextPath } from './next-path'
import { resolveSession, type SessionOwner } from './session'

/**
 * Server Component 侧的会话入口。
 *
 * `proxy.ts` 只做 cookie 存在性的廉价判断（§3.2），真正的会话校验在这里：
 * 会话可能已被登出、已过期、或因改密码而失效，那些都只有查库才知道。
 * 因此「proxy 放行」不等于「已登录」，需要数据的页面必须再走这道。
 */
export async function requireSession(currentPath: string): Promise<SessionOwner> {
  const session = await resolveSession(await readSessionToken())
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(safeNextPath(currentPath))}`)
  }
  return session
}

/** 管理页面未登录重定向；已登录非管理员统一 404。 */
export async function requireAdminSession(currentPath: string): Promise<SessionOwner> {
  const session = await requireSession(currentPath)
  if (session.role !== 'admin') notFound()
  return session
}

/** 已登录用户不该再看到登录 / 注册页（`routing.md` §9.2）。 */
export async function redirectIfAuthenticated(nextPath?: string | null): Promise<void> {
  const session = await resolveSession(await readSessionToken())
  if (session) {
    redirect(nextPath ? safeNextPath(nextPath) : DEFAULT_POST_LOGIN_PATH)
  }
}

export async function optionalSession(): Promise<SessionOwner | null> {
  return resolveSession(await readSessionToken())
}

/**
 * 需要数据的 `/products/*` 页面入口：校验会话后在归属上下文内执行渲染体。
 *
 * 必须由每个 page 自己包而不是包在 layout 里：RSC 的 children 独立渲染，
 * layout 建立的 AsyncLocalStorage 不会传播到子页面的数据获取。
 * `notFound()` / `redirect()` 靠抛异常实现，在上下文内抛出不受影响。
 */
export async function withPageSession<T>(
  currentPath: string,
  render: (session: SessionOwner) => Promise<T>,
): Promise<T> {
  const session = await requireSession(currentPath)
  return runInAuthContext(
    { userId: session.userId, workspaceId: session.workspaceId },
    () => render(session),
  )
}
