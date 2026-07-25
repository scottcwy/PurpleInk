/**
 * 认证域的失败语义（PLAN-002 §3.4）。
 *
 * 核心原则是**不泄露账号是否存在**：
 * - 登录失败（账号不存在 / 口令错）→ 同一个 401 同一句文案；
 * - 请求验证码（已注册 / 未注册）→ 同一个 200 同一句文案，是否真发信在服务端决定。
 * 否则这两个端点就成了账号枚举接口。
 *
 * 文案集中在这里，避免各路由各写一句、无意间造出可区分的差异。
 */
export type AuthFailureCode =
  | 'invalid-input'
  | 'invalid-credentials'
  | 'human-check'
  | 'code-invalid'
  | 'rate-limited'
  | 'mail-unavailable'
  | 'unauthenticated'

export const AUTH_FAILURE_STATUS: Record<AuthFailureCode, number> = {
  'invalid-input': 422,
  // 401 而不是 404：登录端点本身存在，只是这次没通过。
  'invalid-credentials': 401,
  'human-check': 422,
  'code-invalid': 422,
  'rate-limited': 429,
  // 503：通道确实不可用，如实告知而不是假装已发送。与账号是否存在无关，不泄露信息。
  'mail-unavailable': 503,
  unauthenticated: 401,
}

export const AUTH_FAILURE_MESSAGE: Record<AuthFailureCode, string> = {
  'invalid-input': '填写内容不符合要求，请检查后重试',
  'invalid-credentials': '邮箱或密码不正确',
  'human-check': '人机验证未通过，请重新验证',
  'code-invalid': '验证码不正确或已失效，请重新获取',
  'rate-limited': '操作过于频繁，请稍后再试',
  'mail-unavailable': '邮件通道当前不可用，暂时无法发送验证码',
  unauthenticated: '需要登录后才能访问',
}

/** 请求验证码一律回这句，无论该邮箱是否已注册。 */
export const VERIFICATION_CODE_SENT_MESSAGE =
  '如果该邮箱可用于本次操作，验证码已发送，请查收邮件'

export interface AuthFailure {
  ok: false
  code: AuthFailureCode
  /** 可选的字段级提示，只用于 invalid-input；不得携带账号状态。 */
  detail?: string
  retryAfterMs?: number
}

export function authFailure(
  code: AuthFailureCode,
  extra?: { detail?: string; retryAfterMs?: number },
): AuthFailure {
  return { ok: false, code, ...extra }
}

export function isAuthFailure(value: unknown): value is AuthFailure {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { ok?: unknown }).ok === false
    && typeof (value as { code?: unknown }).code === 'string'
  )
}
