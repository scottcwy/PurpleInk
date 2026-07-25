import { describe, expect, it } from 'vitest'
import {
  VERIFICATION_CODE_LENGTH,
  VERIFICATION_CODE_MAX_ATTEMPTS,
  VERIFICATION_CODE_TTL_MS,
  checkVerificationCode,
  generateVerificationCode,
  hashVerificationCode,
  verificationCodeExpiresAt,
} from './verification-code'

const KEY = new Uint8Array(32).fill(7)
const ISSUED_AT = new Date('2026-07-26T10:00:00.000Z')

function record(overrides: Partial<Parameters<typeof checkVerificationCode>[0]> = {}) {
  return {
    codeHash: hashVerificationCode({
      code: '123456',
      email: 'a@example.com',
      purpose: 'signup' as const,
      key: KEY,
    }),
    expiresAt: verificationCodeExpiresAt(ISSUED_AT),
    consumedAt: null,
    attemptCount: 0,
    ...overrides,
  }
}

function candidate(code: string, email = 'a@example.com') {
  return hashVerificationCode({ code, email, purpose: 'signup', key: KEY })
}

describe('verification code generation', () => {
  it('emits fixed-length numeric codes', () => {
    for (let index = 0; index < 200; index += 1) {
      const code = generateVerificationCode()
      expect(code).toMatch(new RegExp(`^\\d{${VERIFICATION_CODE_LENGTH}}$`))
    }
  })

  it('expires exactly 10 minutes after issuing', () => {
    expect(VERIFICATION_CODE_TTL_MS).toBe(600_000)
    expect(verificationCodeExpiresAt(ISSUED_AT).toISOString()).toBe(
      '2026-07-26T10:10:00.000Z',
    )
  })
})

describe('verification code hashing', () => {
  it('binds the digest to email and purpose so a code cannot be replayed elsewhere', () => {
    const forSignup = hashVerificationCode({
      code: '123456',
      email: 'a@example.com',
      purpose: 'signup',
      key: KEY,
    })
    const forReset = hashVerificationCode({
      code: '123456',
      email: 'a@example.com',
      purpose: 'password_reset',
      key: KEY,
    })
    const otherMailbox = hashVerificationCode({
      code: '123456',
      email: 'b@example.com',
      purpose: 'signup',
      key: KEY,
    })

    expect(forSignup).not.toEqual(forReset)
    expect(forSignup).not.toEqual(otherMailbox)
  })

  it('is case-insensitive on the mailbox, matching the users_email_lower_unique index', () => {
    expect(candidate('123456', 'A@Example.com')).toEqual(candidate('123456', 'a@example.com'))
  })

  it('is not brute-forceable without the server key', () => {
    const withOtherKey = hashVerificationCode({
      code: '123456',
      email: 'a@example.com',
      purpose: 'signup',
      key: new Uint8Array(32).fill(8),
    })

    expect(withOtherKey).not.toEqual(candidate('123456'))
  })

  it('produces a fixed-width hex digest', () => {
    expect(candidate('123456')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('verification code checking', () => {
  it('accepts the right code one second before expiry', () => {
    const now = new Date(ISSUED_AT.getTime() + VERIFICATION_CODE_TTL_MS - 1_000)

    expect(checkVerificationCode(record(), candidate('123456'), now)).toEqual({ ok: true })
  })

  it('rejects the right code once expired', () => {
    const now = new Date(ISSUED_AT.getTime() + VERIFICATION_CODE_TTL_MS + 1)

    expect(checkVerificationCode(record(), candidate('123456'), now)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('rejects a wrong code', () => {
    expect(checkVerificationCode(record(), candidate('654321'), ISSUED_AT)).toEqual({
      ok: false,
      reason: 'mismatch',
    })
  })

  it('is one-shot: a consumed code cannot be reused', () => {
    const consumed = record({ consumedAt: new Date(ISSUED_AT.getTime() + 1_000) })

    expect(checkVerificationCode(consumed, candidate('123456'), ISSUED_AT)).toEqual({
      ok: false,
      reason: 'consumed',
    })
  })

  it('voids the code once the attempt budget is spent, even for the right code', () => {
    const exhausted = record({ attemptCount: VERIFICATION_CODE_MAX_ATTEMPTS })

    expect(checkVerificationCode(exhausted, candidate('123456'), ISSUED_AT)).toEqual({
      ok: false,
      reason: 'exhausted',
    })
  })

  it('still allows the final attempt inside the budget', () => {
    const nearlyExhausted = record({ attemptCount: VERIFICATION_CODE_MAX_ATTEMPTS - 1 })

    expect(checkVerificationCode(nearlyExhausted, candidate('123456'), ISSUED_AT)).toEqual({
      ok: true,
    })
  })

  it('reports expiry before mismatch so a stale code is not counted as a guess', () => {
    const now = new Date(ISSUED_AT.getTime() + VERIFICATION_CODE_TTL_MS + 1)

    expect(checkVerificationCode(record(), candidate('654321'), now)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })
})
