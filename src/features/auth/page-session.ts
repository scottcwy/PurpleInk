import 'server-only'
import { redirect } from 'next/navigation'
import { readSessionToken } from '@/lib/auth/session-cookie'
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
