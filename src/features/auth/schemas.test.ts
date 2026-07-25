import { describe, expect, it } from 'vitest'
import {
  emailSchema,
  loginSchema,
  passwordSchema,
  signupSchema,
  verificationCodeSchema,
} from './schemas'

describe('emailSchema', () => {
  it('normalises to lower case and trims, matching users_email_lower_unique', () => {
    expect(emailSchema.parse('  A@Example.COM ')).toBe('a@example.com')
  })

  it('rejects shapes that would slip past a naive check', () => {
    for (const invalid of ['', 'a', 'a@', '@b.com', 'a@b', 'a b@c.com', 'a@b..com', 'a@@b.com']) {
      expect(emailSchema.safeParse(invalid).success).toBe(false)
    }
  })

  it('rejects over-long mailboxes', () => {
    expect(emailSchema.safeParse(`${'a'.repeat(250)}@example.com`).success).toBe(false)
  })
})

describe('passwordSchema', () => {
  it('requires length and mixed character classes', () => {
    expect(passwordSchema.safeParse('short1').success).toBe(false)
    expect(passwordSchema.safeParse('1234567890').success).toBe(false)
    expect(passwordSchema.safeParse('abcdefghij').success).toBe(false)
    expect(passwordSchema.safeParse('purple ink 2026').success).toBe(true)
  })

  it('does not trim the password: leading and trailing spaces are meaningful entropy', () => {
    expect(passwordSchema.parse(' purple ink 2026 ')).toBe(' purple ink 2026 ')
  })
})

describe('verificationCodeSchema', () => {
  it('accepts exactly six digits', () => {
    expect(verificationCodeSchema.parse(' 012345 ')).toBe('012345')
    for (const invalid of ['12345', '1234567', '12345a', '']) {
      expect(verificationCodeSchema.safeParse(invalid).success).toBe(false)
    }
  })
})

describe('request payloads', () => {
  it('signup requires the human check to have been solved', () => {
    expect(
      signupSchema.safeParse({
        email: 'a@example.com',
        name: '示例用户',
        workspaceName: '示例 Workspace',
        password: 'purple ink 2026',
        code: '012345',
      }).success,
    ).toBe(true)
  })

  it('login does not re-apply password strength rules to existing accounts', () => {
    expect(loginSchema.safeParse({ email: 'a@example.com', password: 'x' }).success).toBe(true)
  })
})
