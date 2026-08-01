/**
 * Smoke-session credential boundary.
 *
 * Browser verification uses an application account from CVC_VERIFY_ACCOUNT
 * (email:password), or the server-only demo-account variables. Caddy applies
 * CIDR filtering and security headers; it is not a second login layer.
 */

let sessionCookie = ''

export function authHeaders(): Record<string, string> {
  return sessionCookie ? { cookie: sessionCookie } : {}
}

/** Establish one authenticated application session for smoke requests. */
export async function establishSession(
  baseUrl: string,
  report: Record<string, unknown>,
): Promise<void> {
  const account = process.env.CVC_VERIFY_ACCOUNT ?? demoVerificationAccount()
  if (!account || !account.includes(':')) {
    console.warn('[e2e] CVC_VERIFY_ACCOUNT is not configured; business APIs will return 401')
    report.session = { authenticated: false }
    return
  }

  const separator = account.indexOf(':')
  const email = account.slice(0, separator)
  const password = account.slice(separator + 1)
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) {
    throw new Error(`login failed (HTTP ${response.status}); check CVC_VERIFY_ACCOUNT`)
  }
  const setCookie = response.headers.get('set-cookie') ?? ''
  const match = /cvc_session=([^;]+)/.exec(setCookie)
  if (!match) throw new Error('login response did not include a session cookie')
  sessionCookie = `cvc_session=${match[1]}`
  report.session = { authenticated: true, email: maskEmail(email) }
  console.log('[e2e] application session established')
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
