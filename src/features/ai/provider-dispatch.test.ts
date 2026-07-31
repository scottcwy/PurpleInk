import { describe, expect, it, vi } from 'vitest'
import { providerScopeKey } from './provider-dispatch'
import { nextProviderWindow } from './provider-dispatch-window'
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

describe('provider dispatch clock boundary', () => {
  it('uses the database clock when deciding whether a pacing window is still pending', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-30T05:01:37.000Z'))
    const databaseNow = new Date('2026-07-30T05:02:41.000Z')
    const newest = new Date(databaseNow.getTime() - 1_000)

    try {
      expect(nextProviderWindow({
        limits: {
          concurrency: 8,
          rpm: 180,
          minIntervalMs: 400,
          jitterMs: 0,
        },
        rpm: 1,
        tokens: 0,
        tokenEstimate: 0,
        oldest: newest,
        newest,
        active: 0,
        nextLease: null,
        now: databaseNow,
      })).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
