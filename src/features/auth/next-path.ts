/** 登录成功后的默认落点（`docs/conventions/routing.md` §9.2）。 */
export const DEFAULT_POST_LOGIN_PATH = '/products/dashboard'

const MAX_LENGTH = 512
/** 登录后不该回跳到认证页自身，否则会出现「登录成功 → 又回登录页」的环。 */
const AUTH_PATH_PREFIXES = ['/login', '/signup', '/password'] as const

/**
 * `?next=` 白名单（PLAN-002 §4.4）。只接受站内相对路径；其余一律回落到默认落点。
 *
 * 这是开放重定向的必要防护：拒绝协议相对地址（`//host`）、显式 scheme、
 * 反斜杠变体（浏览器会把 `/\host` 当 `//host`）与控制字符。
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return DEFAULT_POST_LOGIN_PATH
  const value = raw.trim()
  if (!value || value.length > MAX_LENGTH) return DEFAULT_POST_LOGIN_PATH
  if (/[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_POST_LOGIN_PATH
  if (value[0] !== '/') return DEFAULT_POST_LOGIN_PATH
  if (value[1] === '/' || value[1] === '\\') return DEFAULT_POST_LOGIN_PATH
  if (value.includes('\\')) return DEFAULT_POST_LOGIN_PATH
  const path = value.split(/[?#]/, 1)[0] ?? value
  if (AUTH_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return DEFAULT_POST_LOGIN_PATH
  }
  return value
}
