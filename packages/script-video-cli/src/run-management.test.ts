import { describe, expect, it } from 'vitest'

import { isTerminalRunStatus } from './run-management'

describe('run management status', () => {
  it('stops status watch when a video is waiting for Agent review', () => {
    expect(isTerminalRunStatus('awaiting_agent_review')).toBe(true)
    expect(isTerminalRunStatus('running')).toBe(false)
  })
})
