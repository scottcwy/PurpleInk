import { describe, expect, it } from 'vitest'
import {
  classifyMailSendFailure,
  mailErrorCode,
  shouldHideFailureFromCaller,
} from './mail-failure'

/** nodemailer 实测形状：本机代理 TUN/fake-ip 劫持 DNS 时就是这一个。 */
const UNREACHABLE_HOST = { name: 'Error', code: 'ESOCKET', command: 'CONN' }
const AUTH_REJECTED = {
  name: 'Error',
  code: 'EAUTH',
  responseCode: 535,
  command: 'AUTH LOGIN',
}
const RECIPIENT_REJECTED = {
  name: 'Error',
  code: 'EENVELOPE',
  responseCode: 550,
  command: 'RCPT TO',
}

describe('classifyMailSendFailure', () => {
  it('treats transport level failures as channel unavailable', () => {
    for (const error of [
      UNREACHABLE_HOST,
      { code: 'ECONNECTION' },
      { code: 'ETIMEDOUT' },
      { code: 'EDNS' },
      { code: 'ETLS' },
      { code: 'ECONNREFUSED' },
    ]) {
      expect(classifyMailSendFailure(error)).toBe('channel-unavailable')
    }
  })

  it('keeps SMTP auth failure on the channel side despite its 5xx response code', () => {
    // 顺序陷阱：先看 responseCode 会把「我们的账号被拒」误判成收件人被拒，
    // 于是 SMTP 口令过期这种全局故障会被静默成 200。
    expect(classifyMailSendFailure(AUTH_REJECTED)).toBe('channel-unavailable')
  })

  it('treats envelope stage rejection as recipient related', () => {
    expect(classifyMailSendFailure(RECIPIENT_REJECTED)).toBe('recipient-rejected')
    expect(classifyMailSendFailure({ responseCode: 450 })).toBe('recipient-rejected')
  })

  it('defaults unknown shapes to channel unavailable so failures stay visible', () => {
    for (const error of [null, undefined, 'boom', new Error('boom'), {}, { code: 42 }]) {
      expect(classifyMailSendFailure(error)).toBe('channel-unavailable')
    }
  })
})

describe('shouldHideFailureFromCaller', () => {
  it('hides only recipient related failures', () => {
    expect(shouldHideFailureFromCaller('recipient-rejected')).toBe(true)
    expect(shouldHideFailureFromCaller('channel-unavailable')).toBe(false)
    expect(shouldHideFailureFromCaller('not-configured')).toBe(false)
  })
})

describe('mailErrorCode', () => {
  it('reports only the error code, never the provider response text', () => {
    expect(mailErrorCode(UNREACHABLE_HOST)).toBe('ESOCKET')
    expect(
      mailErrorCode({ code: 'EENVELOPE', response: '550 mailbox unavailable for a@b.com' }),
    ).toBe('EENVELOPE')
    expect(mailErrorCode(new Error('boom'))).toBe('unknown')
    expect(mailErrorCode(null)).toBe('unknown')
  })
})
