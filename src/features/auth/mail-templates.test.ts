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

  it('renders the project logo svg in the header, not a text-only wordmark', () => {
    const mail = verificationCodeMail({ purpose: 'signup', code: '012345' })

    expect(mail.html).toContain('<svg')
    expect(mail.html).toContain('PurpleInk')
    expect(mail.html).toContain('viewBox="0 0 167 47"')
  })

  it('removes the old top indigo gradient bar', () => {
    const mail = verificationCodeMail({ purpose: 'signup', code: '012345' })

    // 旧模板标志性的顶部渐变条：高 4px 的 indigo 渐变。
    expect(mail.html).not.toMatch(/height="4".*linear-gradient.*333da7|6366f1|a5b4fc/i)
    expect(mail.html).not.toContain('#a5b4fc')
  })

  it('declares light and dark color-scheme support', () => {
    const mail = verificationCodeMail({ purpose: 'signup', code: '012345' })

    expect(mail.html).toContain('color-scheme: light dark')
    expect(mail.html).toContain('prefers-color-scheme: dark')
  })

  it('uses the homepage surface colors in light mode', () => {
    const mail = verificationCodeMail({ purpose: 'signup', code: '012345' })

    expect(mail.html).toContain('#171a2e') // header ink
    expect(mail.html).toContain('#ffffff') // card
    expect(mail.html).toContain('#f5f5f7') // page bg
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
