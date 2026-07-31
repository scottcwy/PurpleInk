import { describe, expect, it } from 'vitest'
import {
  parseRetryAfter,
  providerErrorFromResponse,
  providerFailureKind,
} from './provider-request-error'

describe('ProviderRequestError', () => {
  it.each([
    [400, 'request'],
    [401, 'auth'],
    [402, 'balance'],
    [403, 'permission'],
    [404, 'request'],
    [408, 'timeout'],
    [413, 'request'],
    [422, 'request'],
    [429, 'rate_limit'],
    [451, 'safety'],
    [500, 'unavailable'],
    [502, 'unavailable'],
    [503, 'unavailable'],
    [504, 'timeout'],
  ] as const)('maps HTTP %s to %s', (status, kind) => {
    expect(providerFailureKind(status)).toBe(kind)
  })

  it('parses Retry-After seconds and HTTP dates', () => {
    const now = new Date('2026-07-29T00:00:00.000Z')
    expect(parseRetryAfter('30', now)?.toISOString()).toBe('2026-07-29T00:00:30.000Z')
    expect(parseRetryAfter('Wed, 29 Jul 2026 00:01:00 GMT', now)?.toISOString())
      .toBe('2026-07-29T00:01:00.000Z')
  })

  it('keeps provider response bodies out of the serializable error', () => {
    const error = providerErrorFromResponse({
      response: new Response('secret provider body', {
        status: 429,
        headers: { 'retry-after': '12', 'x-request-id': 'req-safe-1' },
      }),
      providerId: 'stepfun',
      providerLabel: '阶跃星辰',
      operation: '文本生成',
      funding: 'managed',
    })
    const serialized = JSON.stringify(error)
    expect(serialized).not.toContain('secret provider body')
    expect(error).toMatchObject({
      kind: 'rate_limit',
      httpStatus: 429,
      requestId: 'req-safe-1',
      providerId: 'stepfun',
    })
  })
})
