import { describe, expect, it, vi } from 'vitest'
import {
  SYSTEM_USER_ID,
  currentAuthContext,
  currentUserId,
  currentWorkspaceId,
  runInAuthContext,
} from './workspace-context'

vi.mock('server-only', () => ({}))

const WORKSPACE_A = '00000000-0000-4000-8000-00000000000a'
const WORKSPACE_B = '00000000-0000-4000-8000-00000000000b'

describe('workspace context', () => {
  it('throws instead of falling back when no context is established', () => {
    expect(() => currentWorkspaceId()).toThrow(/workspace context is not established/)
    expect(() => currentUserId()).toThrow(/workspace context is not established/)
  })

  it('never falls back to the historical single-workspace constant', () => {
    // 静默回落会造成跨账户串号，比抛错危险得多（PLAN-002 §10 禁区 5）。
    let message = ''
    try {
      currentWorkspaceId()
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).not.toContain('00000000-0000-4000-8000-000000000001')
  })

  it('exposes the context inside the callback', () => {
    const seen = runInAuthContext({ userId: 'u1', workspaceId: WORKSPACE_A }, () => ({
      workspaceId: currentWorkspaceId(),
      userId: currentUserId(),
    }))

    expect(seen).toEqual({ workspaceId: WORKSPACE_A, userId: 'u1' })
  })

  it('keeps the context across await boundaries', async () => {
    const seen = await runInAuthContext(
      { userId: 'u1', workspaceId: WORKSPACE_A },
      async () => {
        await Promise.resolve()
        await new Promise((resolve) => setTimeout(resolve, 1))
        return currentWorkspaceId()
      },
    )

    expect(seen).toBe(WORKSPACE_A)
  })

  it('isolates concurrent contexts so two workspaces cannot cross-talk', async () => {
    const [a, b] = await Promise.all([
      runInAuthContext({ userId: 'ua', workspaceId: WORKSPACE_A }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return currentWorkspaceId()
      }),
      runInAuthContext({ userId: 'ub', workspaceId: WORKSPACE_B }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return currentWorkspaceId()
      }),
    ])

    expect([a, b]).toEqual([WORKSPACE_A, WORKSPACE_B])
  })

  it('restores the outer context after a nested run', () => {
    const trace = runInAuthContext({ userId: 'ua', workspaceId: WORKSPACE_A }, () => {
      const inner = runInAuthContext(
        { userId: SYSTEM_USER_ID, workspaceId: WORKSPACE_B },
        () => currentWorkspaceId(),
      )
      return [inner, currentWorkspaceId()]
    })

    expect(trace).toEqual([WORKSPACE_B, WORKSPACE_A])
  })

  it('does not leak the context after the callback settles', async () => {
    await runInAuthContext({ userId: 'ua', workspaceId: WORKSPACE_A }, async () =>
      Promise.resolve(),
    )

    expect(currentAuthContext()).toBeUndefined()
  })

  it('rejects an incomplete context at establishment time', () => {
    expect(() => runInAuthContext({ userId: 'u1', workspaceId: '' }, () => null)).toThrow(
      /workspaceId/,
    )
    expect(() => runInAuthContext({ userId: '', workspaceId: WORKSPACE_A }, () => null)).toThrow(
      /userId/,
    )
  })
})
