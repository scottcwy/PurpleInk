import { NextResponse } from 'next/server'
import {
  AUTH_FAILURE_MESSAGE,
  AUTH_FAILURE_STATUS,
  type AuthFailure,
} from './errors'
import type { RequestFingerprint } from './account-service'

/**
 * 认证响应映射（PLAN-002 §3.4）。
 *
 * 所有失败都只回 `{ ok: false, error: 类别文案 }`：不回 provider / SMTP 原始错误、
 * 不回字段级差异、不回 `reason`。速率限制额外带 `Retry-After`。
 */
export function authFailureResponse(failure: AuthFailure): NextResponse {
  const status = AUTH_FAILURE_STATUS[failure.code]
  const headers: Record<string, string> = {}
  if (failure.retryAfterMs !== undefined) {
    headers['Retry-After'] = String(Math.ceil(failure.retryAfterMs / 1000))
  }
  return NextResponse.json(
    { ok: false, error: AUTH_FAILURE_MESSAGE[failure.code] },
    { status, headers },
  )
}

/**
 * 取请求指纹。IP 用于速率限制，只以哈希入库（`throttle.ts`）。
 *
 * 生产部署是「Caddy 反代 → next 容器」，容器看到的 remote 地址恒为反代，
 * 因此必须读转发头。取 `x-forwarded-for` 的**第一段**（最靠近客户端的一跳）；
 * 该头可被伪造，但本产品的入站边界由反代保证（ISSUE-015 P-2），反代会重写它。
 */
export function requestFingerprint(request: Request): RequestFingerprint {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip =
    forwarded?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'unknown'
  return { ip, userAgent: request.headers.get('user-agent') }
}

/** 统一的 JSON body 解析：非法 JSON 交给 zod 报 invalid-input，不抛 500。 */
export async function readJsonBody(request: Request): Promise<unknown> {
  return request.json().catch(() => null)
}
