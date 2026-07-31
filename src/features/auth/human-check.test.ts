import { describe, expect, it } from 'vitest'
import {
  HUMAN_CHECK_MAX_DWELL_MS,
  HUMAN_CHECK_MIN_DWELL_MS,
  createArithmeticChallenge,
  issueHumanCheckToken,
  renderChallengeSvg,
  verifyHumanCheck,
} from './human-check'

const KEY = new Uint8Array(32).fill(3)
const ISSUED_AT = new Date('2026-07-26T10:00:00.000Z')

function tokenFor(answer: string) {
  return issueHumanCheckToken({ answer, issuedAt: ISSUED_AT, key: KEY })
}

function at(offsetMs: number) {
  return new Date(ISSUED_AT.getTime() + offsetMs)
}

describe('arithmetic challenge', () => {
  it('always yields a question whose answer is a non-negative integer string', () => {
    for (let index = 0; index < 300; index += 1) {
      const { question, answer } = createArithmeticChallenge()
      expect(question).toMatch(/^\d+\s[+\-×]\s\d+$/)
      expect(answer).toMatch(/^\d+$/)
      expect(Number(answer)).toBeGreaterThanOrEqual(0)
    }
  })

  it('renders an accessible SVG that never leaks the answer', () => {
    const svg = renderChallengeSvg('7 + 5')

    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-label')
    expect(svg).toContain('7 + 5')
    expect(svg).not.toContain('>12<')
  })

  it('escapes the question so it cannot inject markup', () => {
    const svg = renderChallengeSvg('<script>&"1"')

    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('&amp;')
  })
})

describe('human check token', () => {
  it('carries the answer only as a keyed digest, never in clear text', () => {
    const [issuedAt, answerDigest, signature] = tokenFor('12').split('.')

    expect(issuedAt).toBe(String(ISSUED_AT.getTime()))
    expect(answerDigest).toMatch(/^[0-9a-f]{32}$/)
    expect(signature).toMatch(/^[0-9a-f]{64}$/)
    // 同一 issuedAt 下换答案必须换摘要，说明摘要真的绑定了答案。
    const [, otherDigest] = tokenFor('13').split('.')
    expect(otherDigest).not.toBe(answerDigest)
  })

  it('accepts a human-paced submission with the right answer', () => {
    expect(
      verifyHumanCheck({
        token: tokenFor('12'),
        answer: '12',
        now: at(HUMAN_CHECK_MIN_DWELL_MS + 500),
        key: KEY,
      }),
    ).toEqual({ ok: true })
  })

  it('rejects a non-empty honeypot before looking at anything else', () => {
    expect(
      verifyHumanCheck({
        token: tokenFor('12'),
        answer: '12',
        honeypot: 'https://spam.example',
        now: at(HUMAN_CHECK_MIN_DWELL_MS + 500),
        key: KEY,
      }),
    ).toEqual({ ok: false, reason: 'honeypot' })
  })

  it('treats whitespace-only honeypot input as empty', () => {
    expect(
      verifyHumanCheck({
        token: tokenFor('12'),
        answer: '12',
        honeypot: '   ',
        now: at(HUMAN_CHECK_MIN_DWELL_MS + 500),
        key: KEY,
      }),
    ).toEqual({ ok: true })
  })

  it('rejects a submission faster than a human can fill the form', () => {
    expect(
      verifyHumanCheck({
        token: tokenFor('12'),
        answer: '12',
        now: at(HUMAN_CHECK_MIN_DWELL_MS - 1),
        key: KEY,
      }),
    ).toEqual({ ok: false, reason: 'too-fast' })
  })

  it('rejects a stale form beyond the dwell window', () => {
    expect(
      verifyHumanCheck({
        token: tokenFor('12'),
        answer: '12',
        now: at(HUMAN_CHECK_MAX_DWELL_MS + 1),
        key: KEY,
      }),
    ).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects a token whose issued-at was moved', () => {
    const [issuedAt, answerHash, signature] = tokenFor('12').split('.')
    const moved = [String(Number(issuedAt) - 60_000), answerHash, signature].join('.')

    expect(
      verifyHumanCheck({
        token: moved,
        answer: '12',
        now: at(HUMAN_CHECK_MIN_DWELL_MS + 500),
        key: KEY,
      }),
    ).toEqual({ ok: false, reason: 'tampered' })
  })

  it('rejects a token signed with a different key', () => {
    expect(
      verifyHumanCheck({
        token: issueHumanCheckToken({
          answer: '12',
          issuedAt: ISSUED_AT,
          key: new Uint8Array(32).fill(4),
        }),
        answer: '12',
        now: at(HUMAN_CHECK_MIN_DWELL_MS + 500),
        key: KEY,
      }),
    ).toEqual({ ok: false, reason: 'tampered' })
  })

  it('rejects a wrong answer', () => {
    expect(
      verifyHumanCheck({
        token: tokenFor('12'),
        answer: '13',
        now: at(HUMAN_CHECK_MIN_DWELL_MS + 500),
        key: KEY,
      }),
    ).toEqual({ ok: false, reason: 'wrong-answer' })
  })

  it('tolerates surrounding whitespace in the answer', () => {
    expect(
      verifyHumanCheck({
        token: tokenFor('12'),
        answer: ' 12 ',
        now: at(HUMAN_CHECK_MIN_DWELL_MS + 500),
        key: KEY,
      }),
    ).toEqual({ ok: true })
  })

  it('rejects malformed tokens instead of throwing', () => {
    for (const token of ['', 'abc', 'a.b', '1.2.3.4', 'x.y.z']) {
      expect(
        verifyHumanCheck({
          token,
          answer: '12',
          now: at(HUMAN_CHECK_MIN_DWELL_MS + 500),
          key: KEY,
        }).ok,
      ).toBe(false)
    }
  })
})
