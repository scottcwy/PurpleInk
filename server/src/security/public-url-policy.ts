import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

export type PublicUrlPolicyCode =
  | "URL_INVALID"
  | "URL_PROTOCOL_FORBIDDEN"
  | "URL_CREDENTIALS_FORBIDDEN"
  | "URL_HOST_FORBIDDEN"
  | "URL_HOST_UNRESOLVED"
  | "URL_ADDRESS_NOT_PUBLIC"

export class PublicUrlPolicyError extends Error {
  constructor(readonly code: PublicUrlPolicyCode) {
    super(code)
    this.name = "PublicUrlPolicyError"
  }
}

export type PublicDnsResolver = (
  hostname: string
) => Promise<ReadonlyArray<{ address: string }>>

const defaultResolver: PublicDnsResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true })

const FORBIDDEN_HOSTS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.azure.internal",
  "instance-data",
])

/**
 * URL-to-video 的第一道 SSRF 门禁。
 *
 * 返回去除 fragment 的规范 URL。DNS 结果必须全部为公网地址；解析失败同样拒绝，
 * 避免在“检查失败”时反向降级为放行。
 */
export async function validatePublicUrl(
  raw: string,
  resolveDns: PublicDnsResolver = defaultResolver
): Promise<string> {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new PublicUrlPolicyError("URL_INVALID")
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PublicUrlPolicyError("URL_PROTOCOL_FORBIDDEN")
  }
  if (parsed.username || parsed.password) {
    throw new PublicUrlPolicyError("URL_CREDENTIALS_FORBIDDEN")
  }

  const hostname = normalizeHostname(parsed.hostname)
  if (!hostname || isForbiddenHostname(hostname)) {
    throw new PublicUrlPolicyError("URL_HOST_FORBIDDEN")
  }

  if (isIP(hostname)) {
    assertPublicAddress(hostname)
  } else {
    let addresses: ReadonlyArray<{ address: string }>
    try {
      addresses = await resolveDns(hostname)
    } catch {
      throw new PublicUrlPolicyError("URL_HOST_UNRESOLVED")
    }
    if (addresses.length === 0) {
      throw new PublicUrlPolicyError("URL_HOST_UNRESOLVED")
    }
    for (const answer of addresses) assertPublicAddress(answer.address)
  }

  parsed.hash = ""
  return parsed.toString()
}

export function isPublicAddress(address: string): boolean {
  const normalized = normalizeHostname(address)
  const version = isIP(normalized)
  if (version === 4) return isPublicIpv4(normalized)
  if (version === 6) return isPublicIpv6(normalized)
  return false
}

function assertPublicAddress(address: string): void {
  if (!isPublicAddress(address)) {
    throw new PublicUrlPolicyError("URL_ADDRESS_NOT_PUBLIC")
  }
}

function normalizeHostname(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase()
}

function isForbiddenHostname(hostname: string): boolean {
  return (
    FORBIDDEN_HOSTS.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname === "local" ||
    hostname.endsWith(".local")
  )
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return false
  const [a, b, c] = octets as [number, number, number, number]

  if (a === 0 || a === 10 || a === 127) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 0 && c === 0) return false
  if (a === 192 && b === 0 && c === 2) return false
  if (a === 192 && b === 168) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return a > 0 && a < 224
}

function isPublicIpv6(address: string): boolean {
  const lower = address.toLowerCase()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
  if (mapped) return isPublicIpv4(mapped[1]!)

  // 当前公网单播的可分配主空间是 2000::/3；保守拒绝其它特殊用途空间。
  const first = Number.parseInt(lower.split(":")[0] || "0", 16)
  if (first < 0x2000 || first > 0x3fff) return false
  if (lower === "2001:db8::" || lower.startsWith("2001:db8:")) return false
  return true
}
