import { describe, expect, it, vi } from 'vitest'
import { verifyWorkerGatewayKey } from './worker-gateway-auth'

vi.mock('server-only', () => ({}))

describe('worker gateway service authentication', () => {
  it('fails closed when the service key is missing', () => {
    expect(verifyWorkerGatewayKey('Bearer candidate', undefined))
      .toBe('unconfigured')
  })

  it('accepts only the exact bearer credential', () => {
    expect(verifyWorkerGatewayKey('Bearer shared-secret', 'shared-secret'))
      .toBe('authorized')
    expect(verifyWorkerGatewayKey('Bearer wrong-secret', 'shared-secret'))
      .toBe('unauthorized')
    expect(verifyWorkerGatewayKey('Basic shared-secret', 'shared-secret'))
      .toBe('unauthorized')
  })
})
