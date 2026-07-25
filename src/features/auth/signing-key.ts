import 'server-only'
import { hkdfSync } from 'node:crypto'
import { parseCredentialMasterKey } from '@/features/credentials/credential-envelope'

/**
 * 认证域的对称签名密钥（PLAN-002 §9.4）。
 *
 * 不新增一个生产 secret，而是从 `CVC_CREDENTIAL_MASTER_KEY` 用 HKDF **派生**：
 * 每个用途一条独立 info 标签，派生出的密钥彼此不可互推，也不可反推 master key。
 * 这满足「不得直接用同一 key 做两件事」，同时少一个要进 compose / secret 的变量。
 *
 * 这里派生的是**签名**密钥，与口令哈希无关：口令必须不可逆，绝不经过本模块
 * （AGENTS.md §7）。
 */
const HKDF_SALT = 'cvc.auth.hkdf/v1'
const DERIVED_KEY_BYTES = 32

const PURPOSE_LABELS = {
  verificationCode: 'cvc.auth.verification-code/v1',
  humanCheck: 'cvc.auth.human-check/v1',
  sessionToken: 'cvc.auth.session-token/v1',
} as const

export type AuthSigningPurpose = keyof typeof PURPOSE_LABELS

const cache = new Map<AuthSigningPurpose, Uint8Array>()

/**
 * 取指定用途的派生密钥。缺 master key 时抛错——没有明文 fallback，
 * 因为静默降级会让验证码摘要与会话摘要变成可离线穷举的裸哈希。
 */
export function authSigningKey(purpose: AuthSigningPurpose): Uint8Array {
  const cached = cache.get(purpose)
  if (cached) return cached
  const masterKey = parseCredentialMasterKey(process.env.CVC_CREDENTIAL_MASTER_KEY)
  const derived = new Uint8Array(
    hkdfSync('sha256', masterKey, HKDF_SALT, PURPOSE_LABELS[purpose], DERIVED_KEY_BYTES),
  )
  cache.set(purpose, derived)
  return derived
}

/** 仅供测试重置派生缓存；生产路径不应调用。 */
export function resetAuthSigningKeyCache(): void {
  cache.clear()
}
