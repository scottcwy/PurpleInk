import { describe, expect, it } from 'vitest'
import { maskMailbox, verificationCodeMail } from './mail-templates'

describe('verification code mail', () => {
  it('states the 10 minute validity and one-shot rule in both parts', () => {
    const mail = verificationCodeMail({ purpose: 'signup', code: '012345' })

    for (const part of [mail.text, mail.html]) {
      expect(part).toContain('10 分钟')
      expect(part).toContain('只能使用一次')
      expect(part).toContain('012345')
    }
  })

  it('uses distinct subjects per purpose so the mailbox is self-explanatory', () => {
    expect(verificationCodeMail({ purpose: 'signup', code: '012345' }).subject).toContain('注册')
    expect(
      verificationCodeMail({ purpose: 'password_reset', code: '012345' }).subject,
    ).toContain('重置密码')
  })

  it('never reveals whether the mailbox already has an account', () => {
    const mail = verificationCodeMail({ purpose: 'password_reset', code: '012345' })

    for (const leak of ['已注册', '未注册', '不存在', '已存在']) {
      expect(mail.text).not.toContain(leak)
      expect(mail.html).not.toContain(leak)
    }
  })

  it('carries no emoji', () => {
    const mail = verificationCodeMail({ purpose: 'signup', code: '012345' })

    expect(/\p{Extended_Pictographic}/u.test(mail.text + mail.html)).toBe(false)
  })

  it('escapes the html body', () => {
    const mail = verificationCodeMail({ purpose: 'signup', code: '<b>1</b>' })

    expect(mail.html).not.toContain('<b>1</b>')
    expect(mail.html).toContain('&lt;b&gt;1&lt;/b&gt;')
  })

  it('carries the official site, docs and contact links in both parts', () => {
    const mail = verificationCodeMail({ purpose: 'signup', code: '012345' })

    for (const part of [mail.text, mail.html]) {
      expect(part).toContain('purpleink.cn')
      expect(part).toContain('docs.purpleink.cn')
      expect(part).toContain('support@purpleink.cn')
    }
  })

  it('uses the brand indigo gradient spectrum, not a flat single color', () => {
    const mail = verificationCodeMail({ purpose: 'signup', code: '012345' })

    expect(mail.html).toContain('#333da7')
    expect(mail.html).toContain('#6366f1')
    expect(mail.html).toContain('#a5b4fc')
  })
})

describe('maskMailbox', () => {
  it('keeps only the first character and the domain', () => {
    expect(maskMailbox('someone@example.com')).toBe('s***@example.com')
  })

  it('degrades safely on malformed input rather than echoing it', () => {
    expect(maskMailbox('not-an-email')).toBe('***')
    expect(maskMailbox('')).toBe('***')
  })
})
