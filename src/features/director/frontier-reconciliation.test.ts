import { beforeEach, describe, expect, it, vi } from 'vitest'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import type { PipelineResumeResult } from './advance'
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

  it('resumes only the bounded number of persisted frontiers per pass', async () => {
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

    expect(observedContexts).toEqual([candidates[0]!.workspaceId])
    expect(resume.mock.calls).toEqual([[candidates[0]!.projectId]])
    expect(result).toEqual({
      reconciledProjectIds: [candidates[0]!.projectId],
      failedProjectIds: [],
      deferredProjectIds: [],
    })
  })

  it('continues past a lock-busy candidate so it cannot starve the next project', async () => {
    const resume = vi.fn(async () => ({
      autopilot: true as const,
      status: 'started' as const,
      enqueuedNodeIds: ['next'],
      repairRootNodeIds: [],
      failedNodeIds: [],
      blockedNodes: [],
    }))
    const lockProject = vi.fn(
      async (projectId: string, operation: () => Promise<PipelineResumeResult>) =>
        projectId === candidates[0]!.projectId ? null : operation()
    )

    const result = await reconcileDirectorFrontiers({} as never, {
      listCandidates: vi.fn(async () => candidates),
      resume,
      lockProject,
    })

    expect(lockProject).toHaveBeenCalledTimes(2)
    expect(resume).toHaveBeenCalledWith(candidates[1]!.projectId)
    expect(result).toEqual({
      reconciledProjectIds: [candidates[1]!.projectId],
      failedProjectIds: [],
      deferredProjectIds: [candidates[0]!.projectId],
    })
  })

  it('continues past consecutive blocked candidates with no persisted progress', async () => {
    const thirdCandidate: DirectorFrontierCandidate = {
      workspaceId: '00000000-0000-4000-8000-000000000103',
      projectId: '00000000-0000-4000-8000-000000000203',
    }
    const resume = vi.fn()
      .mockResolvedValueOnce({
        autopilot: true,
        status: 'blocked',
        enqueuedNodeIds: [],
        repairRootNodeIds: [],
        failedNodeIds: [],
        blockedNodes: [{
          nodeId: 'media-1',
          code: 'MEDIA_NOT_READY',
          message: '媒体尚未就绪',
        }],
      })
      .mockResolvedValueOnce({
        autopilot: true,
        status: 'blocked',
        enqueuedNodeIds: [],
        repairRootNodeIds: [],
        failedNodeIds: [],
        blockedNodes: [{
          nodeId: 'media-2',
          code: 'MEDIA_NOT_READY',
          message: '媒体尚未就绪',
        }],
      })
      .mockResolvedValueOnce({
        autopilot: true,
        status: 'started',
        enqueuedNodeIds: ['next'],
        repairRootNodeIds: [],
        failedNodeIds: [],
        blockedNodes: [],
      })

    const result = await reconcileDirectorFrontiers({} as never, {
      listCandidates: vi.fn(async () => [...candidates, thirdCandidate]),
      resume,
      lockProject: (_projectId, operation) => operation(),
    })

    expect(resume.mock.calls).toEqual([
      [candidates[0]!.projectId],
      [candidates[1]!.projectId],
      [thirdCandidate.projectId],
    ])
    expect(result).toEqual({
      reconciledProjectIds: [thirdCandidate.projectId],
      failedProjectIds: [],
      deferredProjectIds: candidates.map(({ projectId }) => projectId),
    })
  })

  it('reaches the seventeenth candidate when the first sixteen make no progress', async () => {
    const crowdedCandidates = Array.from({ length: 17 }, (_, index) => ({
      workspaceId: '00000000-0000-4000-8000-000000000101',
      projectId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    }))
    const resume = vi.fn(async (projectId: string) => {
      const madeProgress = projectId === crowdedCandidates.at(-1)!.projectId
      return {
        autopilot: true as const,
        status: madeProgress ? 'started' as const : 'blocked' as const,
        enqueuedNodeIds: madeProgress ? ['next'] : [],
        repairRootNodeIds: [],
        failedNodeIds: [],
        blockedNodes: madeProgress
          ? []
          : [{
              nodeId: 'media',
              code: 'MEDIA_NOT_READY',
              message: '媒体尚未就绪',
            }],
      }
    })

    const result = await reconcileDirectorFrontiers({} as never, {
      listCandidates: vi.fn(async () => crowdedCandidates),
      resume,
      lockProject: (_projectId, operation) => operation(),
    })

    expect(resume).toHaveBeenCalledTimes(17)
    expect(result.reconciledProjectIds).toEqual([
      crowdedCandidates.at(-1)!.projectId,
    ])
    expect(result.deferredProjectIds).toEqual(
      crowdedCandidates.slice(0, -1).map(({ projectId }) => projectId),
    )
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
