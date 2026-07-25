import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { VERIFICATION_PURPOSES } from '@/lib/db/schema/auth'

export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number]

/** 6 位数字对用户友好，熵低，所以哈希、尝试次数、过期与一次性消费必须同时到位。 */
export const VERIFICATION_CODE_LENGTH = 6
export const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000
export const VERIFICATION_CODE_MAX_ATTEMPTS = 5

const HASH_DOMAIN = 'cvc.auth.verification-code/v1'

/** 均匀分布的 6 位数字码；`randomInt` 是 CSPRNG，不用 `Math.random`。 */
export function generateVerificationCode(): string {
  const upperBound = 10 ** VERIFICATION_CODE_LENGTH
  return String(randomInt(0, upperBound)).padStart(VERIFICATION_CODE_LENGTH, '0')
}

export function verificationCodeExpiresAt(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + VERIFICATION_CODE_TTL_MS)
}

/**
 * 带密钥的摘要（HMAC-SHA256），不是裸 SHA-256。
 *
 * 6 位码只有 10^6 种，裸哈希落库后拿到备份即可离线穷举；HMAC 让攻击者必须先拿到
 * server-only 派生密钥。同时把 email 与 purpose 编进消息，因此注册码无法被拿去
 * 走重置流程、也无法换个邮箱重放。
 */
export function hashVerificationCode(input: {
  code: string
  email: string
  purpose: VerificationPurpose
  key: Uint8Array
}): string {
  const message = [
    HASH_DOMAIN,
    input.purpose,
    input.email.trim().toLowerCase(),
    input.code.trim(),
  ].join('\u0000')
  return createHmac('sha256', input.key).update(message, 'utf8').digest('hex')
}

export interface VerificationCodeRecord {
  codeHash: string
  expiresAt: Date
  consumedAt: Date | null
  attemptCount: number
}

export type VerificationFailureReason = 'expired' | 'consumed' | 'exhausted' | 'mismatch'
export type VerificationResult =
  | { ok: true }
  | { ok: false; reason: VerificationFailureReason }

/**
 * 纯校验：不写库、不计数。调用方（`auth-repository`）负责递增 `attemptCount`
 * 与写 `consumedAt`。
 *
 * 判定顺序刻意是 consumed → expired → exhausted → mismatch：已消费或已过期的码
 * 不该再消耗尝试预算，否则攻击者可以用过期码把受害者的预算刷空。
 */
export function checkVerificationCode(
  record: VerificationCodeRecord,
  candidateHash: string,
  now: Date,
): VerificationResult {
  if (record.consumedAt) return { ok: false, reason: 'consumed' }
  if (record.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' }
  if (record.attemptCount >= VERIFICATION_CODE_MAX_ATTEMPTS) {
    return { ok: false, reason: 'exhausted' }
  }
  if (!hashesEqual(record.codeHash, candidateHash)) return { ok: false, reason: 'mismatch' }
  return { ok: true }
}

function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
