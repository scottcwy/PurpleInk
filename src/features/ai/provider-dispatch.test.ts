import { describe, expect, it, vi } from 'vitest'
import { providerScopeKey } from './provider-dispatch'
import { providerPoolPolicy } from './provider-pool-policy'

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

  it('does not create a new managed pool when the server credential rotates', () => {
    const first = providerScopeKey({
      providerId: 'gemini',
      funding: 'managed',
      workspaceId: 'workspace-a',
      apiKey: 'old-managed-key',
    })
    const rotated = providerScopeKey({
      providerId: 'gemini',
      funding: 'managed',
      workspaceId: 'workspace-b',
      apiKey: 'new-managed-key',
    })
    expect(first).toBe(rotated)
  })

  it('defines independent conservative policies for the three managed pools', () => {
    expect(providerPoolPolicy('gemini')).toMatchObject({
      contractRpm: 1_000,
      softRpm: 750,
      hardRpm: 900,
      minIntervalMs: 80,
      jitterMs: 8,
      initialConcurrency: 8,
      maxConcurrency: 50,
    })
    expect(providerPoolPolicy('stepfun')).toMatchObject({
      contractRpm: 200,
      softRpm: 150,
      hardRpm: 180,
      minIntervalMs: 400,
      jitterMs: 40,
    })
    expect(providerPoolPolicy('mimo')).toMatchObject({
      contractRpm: 100,
      softRpm: 75,
      hardRpm: 90,
      minIntervalMs: 800,
      jitterMs: 80,
    })
  })
})
