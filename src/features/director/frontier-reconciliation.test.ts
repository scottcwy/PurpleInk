import { beforeEach, describe, expect, it, vi } from 'vitest'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import {
  DIRECTOR_FRONTIER_RECOVERY_LIMIT,
  DIRECTOR_FRONTIER_RECOVERY_WINDOW_MS,
  reconcileDirectorFrontiers,
  type DirectorFrontierCandidate,
} from './frontier-reconciliation'

vi.mock('server-only', () => ({}))

const candidates: DirectorFrontierCandidate[] = [
  {
    workspaceId: '00000000-0000-4000-8000-000000000101',
    projectId: '00000000-0000-4000-8000-000000000201',
  },
  {
    workspaceId: '00000000-0000-4000-8000-000000000102',
    projectId: '00000000-0000-4000-8000-000000000202',
  },
]

describe('reconcileDirectorFrontiers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('publishes the bounded recent-crash recovery policy', () => {
    expect(DIRECTOR_FRONTIER_RECOVERY_WINDOW_MS).toBe(15 * 60 * 1_000)
    expect(DIRECTOR_FRONTIER_RECOVERY_LIMIT).toBe(1)
  })

  it('resumes every persisted ready frontier inside its owning workspace', async () => {
    const observedContexts: string[] = []
    const resume = vi.fn(async () => {
      observedContexts.push(currentWorkspaceId())
      return {
        autopilot: true as const,
        status: 'started' as const,
        enqueuedNodeIds: ['next'],
        repairRootNodeIds: [],
        failedNodeIds: [],
        blockedNodes: [],
      }
    })

    const result = await reconcileDirectorFrontiers({} as never, {
      listCandidates: vi.fn(async () => candidates),
      resume,
      lockProject: (_projectId, operation) => operation(),
    })

    expect(observedContexts).toEqual(candidates.map(({ workspaceId }) => workspaceId))
    expect(resume.mock.calls).toEqual(
      candidates.map(({ projectId }) => [projectId]),
    )
    expect(result).toEqual({
      reconciledProjectIds: candidates.map(({ projectId }) => projectId),
      failedProjectIds: [],
      deferredProjectIds: [],
    })
  })

  it('defers a project when another process owns its frontier lock', async () => {
    const resume = vi.fn()

    const result = await reconcileDirectorFrontiers({} as never, {
      listCandidates: vi.fn(async () => [candidates[0]!]),
      resume,
      lockProject: vi.fn(async () => null),
    })

    expect(resume).not.toHaveBeenCalled()
    expect(result).toEqual({
      reconciledProjectIds: [],
      failedProjectIds: [],
      deferredProjectIds: [candidates[0]!.projectId],
    })
  })

  it('logs only structured identifiers and never a raw reconciliation error', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const resume = vi.fn()
      .mockRejectedValueOnce(new Error('provider secret response'))
      .mockResolvedValueOnce({
        autopilot: true,
        status: 'started',
        enqueuedNodeIds: ['next'],
        repairRootNodeIds: [],
        failedNodeIds: [],
        blockedNodes: [],
      })

    const result = await reconcileDirectorFrontiers({} as never, {
      listCandidates: vi.fn(async () => candidates),
      resume,
      lockProject: (_projectId, operation) => operation(),
    })

    expect(result).toEqual({
      reconciledProjectIds: [candidates[1]!.projectId],
      failedProjectIds: [candidates[0]!.projectId],
      deferredProjectIds: [],
    })
    expect(JSON.stringify(warning.mock.calls)).not.toContain('provider secret response')
    expect(warning).toHaveBeenCalledWith(
      '[director_frontier_reconcile_failed]',
      expect.objectContaining({
        projectId: candidates[0]!.projectId,
        workspaceId: candidates[0]!.workspaceId,
        code: 'FRONTIER_RECONCILE_FAILED',
      }),
    )
  })
})
