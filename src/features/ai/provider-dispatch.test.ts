import { describe, expect, it, vi } from 'vitest'
import { providerLimits, providerScopeKey } from './provider-dispatch'

vi.mock('server-only', () => ({}))

describe('provider dispatch configuration', () => {
  it('keeps managed credentials global and BYOK credentials workspace-scoped', () => {
    const base = {
      providerId: 'stepfun',
      apiKey: 'never-log-this',
    }
    const managedA = providerScopeKey({
      ...base,
      funding: 'managed',
      workspaceId: 'workspace-a',
    })
    const managedB = providerScopeKey({
      ...base,
      funding: 'managed',
      workspaceId: 'workspace-b',
    })
    const byokA = providerScopeKey({ ...base, funding: 'byok', workspaceId: 'workspace-a' })
    const byokB = providerScopeKey({ ...base, funding: 'byok', workspaceId: 'workspace-b' })
    expect(managedA).toBe(managedB)
    expect(byokA).not.toBe(byokB)
    expect(managedA).not.toContain(base.apiKey)
  })

  it('uses the confirmed StepFun 5 RPM as a rate limit, not lane concurrency', () => {
    expect(providerLimits('stepfun')).toMatchObject({ rpm: 5, concurrency: 5 })
  })
})
