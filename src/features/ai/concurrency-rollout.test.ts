import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

describe('AI concurrency rollout', () => {
  it('fails closed for missing or invalid enforcement percentages', async () => {
    const { enforcementPercent } = await import('./concurrency-rollout')
    expect(enforcementPercent(undefined)).toBe(100)
    expect(enforcementPercent('101')).toBe(100)
    expect(enforcementPercent('-1')).toBe(100)
    expect(enforcementPercent('oops')).toBe(100)
  })

  it('supports shadow, full enforcement, and stable workspace buckets', async () => {
    const { workspaceConcurrencyEnforced } = await import('./concurrency-rollout')
    const workspaceId = '41000000-0000-4000-8000-000000000001'
    expect(workspaceConcurrencyEnforced(workspaceId, {
      AI_SHOT_CONCURRENCY_ENFORCEMENT_PERCENT: '0',
    })).toBe(false)
    expect(workspaceConcurrencyEnforced(workspaceId, {
      AI_SHOT_CONCURRENCY_ENFORCEMENT_PERCENT: '100',
    })).toBe(true)
    const environment = {
      AI_SHOT_CONCURRENCY_ENFORCEMENT_PERCENT: '50',
    }
    expect(workspaceConcurrencyEnforced(workspaceId, environment)).toBe(
      workspaceConcurrencyEnforced(workspaceId, environment),
    )
  })

  it('keeps managed provider pools on explicit global modes', async () => {
    const { providerPoolMode } = await import('./concurrency-rollout')
    expect(providerPoolMode({ AI_PROVIDER_POOL_MODE: 'shadow' })).toBe('shadow')
    expect(providerPoolMode({ AI_PROVIDER_POOL_MODE: 'enforce' })).toBe('enforce')
    expect(providerPoolMode({ AI_PROVIDER_POOL_MODE: 'invalid' })).toBe('enforce')
  })
})
