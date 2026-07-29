import { describe, expect, it } from 'vitest'
import { getNodeStatusPresentation } from './flow-elements'

describe('workflow confirmation block presentation', () => {
  it('shows blocked as a warning confirmation gate rather than a failure', () => {
    const blocked = getNodeStatusPresentation('blocked')

    expect(blocked.label).toBe('等待降级确认')
    expect(blocked.variant).toBe('pending')
    expect(blocked.icon).toBeDefined()
  })
})
