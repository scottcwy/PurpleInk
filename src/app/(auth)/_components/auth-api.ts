/**
 * 认证页的客户端出口。
 *
 * 所有认证 POST 只经这里，因此「服务端只回类别文案」这条口径在前端也只有一处
 * 消费点：不猜测原因、不把 HTTP 状态翻译成第二套文案、不区分「账号不存在」与
 * 「口令错」（PLAN-002 §3.4）。
 */

export interface AuthRequestFailure {
  message: string
  /** 429 的 `Retry-After`（秒）。用于把按钮冷却与服务端限流对齐。 */
  retryAfterSeconds?: number
}

export class AuthRequestError extends Error {
  readonly retryAfterSeconds?: number

  constructor(failure: AuthRequestFailure) {
    super(failure.message)
    this.name = 'AuthRequestError'
    this.retryAfterSeconds = failure.retryAfterSeconds
  }
}

const FALLBACK_MESSAGE = '请求未能完成，请稍后重试'

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AuthRequestError({ message: '网络连接失败，请检查网络后重试' })
  }
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('Retry-After'))
    throw new AuthRequestError({
      message: readError(payload) ?? FALLBACK_MESSAGE,
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    })
  }
  return payload as T
}

function readError(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const message = (payload as { error?: unknown }).error
  return typeof message === 'string' && message ? message : undefined
}

export interface HumanCheckChallenge {
  token: string
  question: string
  svg: string
}

export async function fetchHumanCheckChallenge(): Promise<HumanCheckChallenge> {
  const response = await fetch('/api/auth/human-check', { cache: 'no-store' })
  if (!response.ok) throw new AuthRequestError({ message: '验证题获取失败，请重试' })
  return (await response.json()) as HumanCheckChallenge
}

export interface HumanCheckAnswer {
  humanCheckToken: string
  humanCheckAnswer: string
  contactReference: string
}

/** 签发注册 / 重置验证码。两个端点回同一句文案，前端也不区分。 */
export async function requestVerificationCode(
  purpose: 'signup' | 'password_reset',
  input: { email: string } & HumanCheckAnswer,
): Promise<{ message: string }> {
  const path = purpose === 'signup' ? '/api/auth/signup/code' : '/api/auth/password/code'
  return postJson<{ ok: true; message: string }>(path, input)
}

export async function login(input: {
  email: string
  password: string
  next?: string
}): Promise<{ redirectTo: string }> {
  return postJson<{ ok: true; redirectTo: string }>('/api/auth/login', input)
}

export async function signup(input: {
  email: string
  name: string
  workspaceName: string
  password: string
  code: string
  next?: string
}): Promise<{ redirectTo: string }> {
  return postJson<{ ok: true; redirectTo: string }>('/api/auth/signup', input)
}

export async function resetPassword(input: {
  email: string
  code: string
  password: string
}): Promise<{ redirectTo: string }> {
  return postJson<{ ok: true; redirectTo: string }>('/api/auth/password/reset', input)
}
