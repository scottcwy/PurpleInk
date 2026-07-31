import { createHash, timingSafeEqual } from "node:crypto"

export type InternalAuthResult = "authorized" | "unauthorized" | "unconfigured"

export interface InternalAuthHeaders {
  authorization?: string | string[]
  "x-purpleink-engine-key"?: string | string[]
}

/** Internal 路由只接受 server-only key；未配置时 fail closed。 */
export function verifyInternalEngineKey(
  headers: InternalAuthHeaders,
  configuredKey = process.env.PURPLEINK_ENGINE_INTERNAL_KEY
): InternalAuthResult {
  if (!configuredKey) return "unconfigured"

  const candidates = [
    extractBearer(first(headers.authorization)),
    first(headers["x-purpleink-engine-key"]),
  ].filter((value): value is string => Boolean(value))

  return candidates.some((candidate) => constantTimeEqual(candidate, configuredKey))
    ? "authorized"
    : "unauthorized"
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function extractBearer(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = /^Bearer[ \t]+(.+)$/i.exec(value)
  return match?.[1]
}

function constantTimeEqual(received: string, expected: string): boolean {
  const left = createHash("sha256").update(received).digest()
  const right = createHash("sha256").update(expected).digest()
  return timingSafeEqual(left, right)
}
