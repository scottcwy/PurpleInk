/**
 * 取证脚本的凭据注入出口（PLAN-001 §1.6 / PLAN-002 §9.5 共用的唯一出口）。
 *
 * 两类凭据都从这里进：
 * - 反代 Basic Auth（ISSUE-015 P-2）：env `CVC_VERIFY_BASIC_AUTH`（user:pass）；
 * - 应用内会话（PLAN-002 阶段 B）：优先读取 `CVC_VERIFY_ACCOUNT`
 *   （email:password），本地无人值守验证可回退到 demo 账号的两个 server-only env；
 *   先调 `/api/auth/login` 拿会话 cookie，后续请求经 `authHeaders()` 携带。
 *
 * Node fetch 不接受 URL 内嵌凭据（`https://user:pass@host` 直接抛 TypeError），
 * 因此一律走请求头而非 URL。
 */

/** 未设置时返回空对象，行为与反代落地前完全一致（不发该头）。 */
export function basicAuthHeaders(): Record<string, string> {
  const credentials = process.env.CVC_VERIFY_BASIC_AUTH
  if (!credentials) return {}
  return { Authorization: `Basic ${Buffer.from(credentials).toString('base64')}` }
}

/** 登录后的会话 cookie；只在本模块内可变，外部经 `authHeaders()` 消费。 */
let sessionCookie = ''

export function authHeaders(): Record<string, string> {
  return {
    ...basicAuthHeaders(),
    ...(sessionCookie ? { cookie: sessionCookie } : {}),
  }
}

/**
 * 应用内登录。凭据必须是真实注册账号；未设置时如实提示并继续
 * （后续业务请求会被 401 拒绝，错误信息会说明原因）。
 * 不回显凭据与 provider 原始错误，只报类别。
 */
export async function establishSession(
  baseUrl: string,
  report: Record<string, unknown>,
): Promise<void> {
  const account = process.env.CVC_VERIFY_ACCOUNT
    ?? demoVerificationAccount()
  if (!account || !account.includes(':')) {
    console.warn('[e2e] 未设置 CVC_VERIFY_ACCOUNT（email:password），业务 API 将回 401')
    report.session = { authenticated: false }
    return
  }
  const separator = account.indexOf(':')
  const email = account.slice(0, separator)
  const password = account.slice(separator + 1)
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...basicAuthHeaders() },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) {
    throw new Error(`登录失败（HTTP ${response.status}），请核对 CVC_VERIFY_ACCOUNT`)
  }
  const setCookie = response.headers.get('set-cookie') ?? ''
  const match = /cvc_session=([^;]+)/.exec(setCookie)
  if (!match) throw new Error('登录响应未携带会话 cookie')
  sessionCookie = `cvc_session=${match[1]}`
  report.session = { authenticated: true, email: maskEmail(email) }
  console.log('[e2e] 会话已建立（真实注册账号）')
}

function demoVerificationAccount(): string | undefined {
  const email = process.env.CVC_DEMO_ACCOUNT_EMAIL
  const password = process.env.CVC_DEMO_ACCOUNT_PASSWORD
  return email && password ? `${email}:${password}` : undefined
}

function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 1) return '***'
  return `${email[0]}***${email.slice(at)}`
}
