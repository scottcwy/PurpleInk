import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(async () => ({ kind: 'db' })),
  cancelDeferredAttempt: vi.fn(async () => 'attempt-1'),
  transitionNodeStatus: vi.fn(async () => undefined),
  releaseTerminalWorkflowSlotForNode: vi.fn(async () => undefined),
}))

vi.mock('@/lib/auth/workspace-context', () => ({
  currentWorkspaceId: () => 'workspace-1',
}))
vi.mock('@/lib/db/client', () => ({ getDb: mocks.getDb }))
vi.mock('@/lib/queue/cancel-deferred', () => ({
  cancelDeferredAttempt: mocks.cancelDeferredAttempt,
}))
vi.mock('@/features/canvas/status', () => ({
  transitionNodeStatus: mocks.transitionNodeStatus,
}))
vi.mock('@/features/ai/workspace-concurrency-release', () => ({
  releaseTerminalWorkflowSlotForNode: mocks.releaseTerminalWorkflowSlotForNode,
}))

beforeEach(() => vi.clearAllMocks())

it('releases the shot concurrency slot after cancelling a provider wait', async () => {
  const { cancelProviderWaitAction } = await import('./cancel-wait')
  await cancelProviderWaitAction({ projectId: 'project-1', nodeId: 'node-1' })
  expect(mocks.releaseTerminalWorkflowSlotForNode).toHaveBeenCalledWith({
    workspaceId: 'workspace-1',
    nodeId: 'node-1',
    database: { kind: 'db' },
  })
})
