import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  MANAGED_CREDENTIAL_ENV,
  resolveManagedCredential,
} from './managed-credentials'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('resolveManagedCredential', () => {
  it.each([
    ['stepfun', 'CVC_MANAGED_STEPFUN_API_KEY'],
    ['mimo', 'CVC_MANAGED_MIMO_API_KEY'],
    ['gemini', 'CVC_MANAGED_GEMINI_API_KEY'],
    ['openai', 'CVC_MANAGED_OPENAI_API_KEY'],
    ['anthropic', 'CVC_MANAGED_ANTHROPIC_API_KEY'],
  ] as const)('reads only the managed %s credential', (provider, envName) => {
    process.env[envName] = `test-${provider}-secret`

    expect(resolveManagedCredential(provider)).toBe(`test-${provider}-secret`)
    expect(MANAGED_CREDENTIAL_ENV[provider]).toBe(envName)
  })

  it('returns null for an absent or whitespace-only credential', () => {
    delete process.env.CVC_MANAGED_STEPFUN_API_KEY
    process.env.CVC_MANAGED_MIMO_API_KEY = '   '

    expect(resolveManagedCredential('stepfun')).toBeNull()
    expect(resolveManagedCredential('mimo')).toBeNull()
  })

  it('does not fall back to legacy or BYOK credential names', () => {
    process.env.STEPFUN_API_KEY = 'legacy-secret'
    process.env.GEMINI_API_KEY = 'byok-secret'

    expect(resolveManagedCredential('stepfun')).toBeNull()
    expect(resolveManagedCredential('gemini')).toBeNull()
  })
})
