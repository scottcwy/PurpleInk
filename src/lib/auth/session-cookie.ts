import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'

/**
 * 会话 cookie 的属性与读写（PLAN-002 §1.3）。
 *
 * 有意用 cookie 而不是 `Authorization` 头：客户端画布状态流走同源 `EventSource`，
 * 而 `EventSource` **无法设置自定义请求头**。放头里会让 SSE 静默退化成轮询兜底，
 * 极难归因（§10 禁区 3）。
 *
 * cookie 里只有高熵随机明文，不含任何用户信息；服务端 `sessions` 表存其 SHA-256。
 */
export const SESSION_COOKIE_NAME = 'cvc_session'

/** 30 天。改口令会失效全部旧会话，因此长有效期不等于长期风险。 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * `SameSite=Lax` 足够：本产品没有跨站 POST 需求，而 Lax 能让「从外部链接点进
 * /products/*」仍带上会话。`Secure` 只在生产开启，否则本地 http 下浏览器会
 * 直接丢弃 cookie。
 */
function baseAttributes() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  } as const
}

export function attachSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date,
): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    expires: expiresAt,
    ...baseAttributes(),
  })
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    maxAge: 0,
    ...baseAttributes(),
  })
}

/** 从当前请求读会话明文；Next 16 的 `cookies()` 必须 await（AGENTS.md §5）。 */
export async function readSessionToken(): Promise<string | null> {
  const store = await cookies()
  const value = store.get(SESSION_COOKIE_NAME)?.value?.trim()
  return value ? value : null
}
