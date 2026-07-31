import { describe, expect, it, vi } from 'vitest'
import { activeWorkflowVersionFor } from '@/lib/workflow/project-workflow-registry'
import {
  startProjectWorkflow,
  type ProjectWorkflowStartDependencies,
} from './project-workflow-start'

vi.mock('server-only', () => ({}))

const PROJECT_ID = '10000000-0000-4000-8000-000000000001'
const ENTRY_ID = '20000000-0000-4000-8000-000000000001'

function dependencies(
  kind: 'script' | 'audio' | 'website',
): ProjectWorkflowStartDependencies {
  const workflowVersion = activeWorkflowVersionFor(kind)
  return {
    loadDescriptor: vi.fn(async () => ({
      kind,
      workflowVersion,
      entryNodeId: ENTRY_ID,
    })),
    startScript: vi.fn(async () => ({
      autopilot: true as const,
      status: 'started' as const,
      enqueuedNodeIds: [ENTRY_ID],
      repairRootNodeIds: [],
      failedNodeIds: [],
      blockedNodes: [],
    })),
    resumeAudio: vi.fn(async () => ({
      status: 'started' as const,
      enqueuedNodeIds: [ENTRY_ID],
      repairRootNodeIds: [],
      failedNodeIds: [],
      blockedNodes: [],
    })),
    enqueueAudio: vi.fn(async () => ({
      attemptId: 'audio-attempt',
      status: 'queued' as const,
      reused: false,
    })),
    enqueueWebsite: vi.fn(async () => ({
      attemptId: 'website-attempt',
      status: 'queued' as const,
      reused: false,
    })),
  }
}

describe('startProjectWorkflow', () => {
  it('keeps the established script Director start result intact', async () => {
    const deps = dependencies('script')
    await expect(startProjectWorkflow(PROJECT_ID, deps)).resolves.toEqual({
      kind: 'script',
      entryNodeId: ENTRY_ID,
      autopilot: true,
      status: 'started',
      enqueuedNodeIds: [ENTRY_ID],
      repairRootNodeIds: [],
      failedNodeIds: [],
      blockedNodes: [],
    })
    expect(deps.startScript).toHaveBeenCalledWith(PROJECT_ID)
    expect(deps.enqueueAudio).not.toHaveBeenCalled()
    expect(deps.enqueueWebsite).not.toHaveBeenCalled()
  })

  it('dispatches audio from the persisted descriptor and trusted entry node', async () => {
    const deps = dependencies('audio')
    await expect(startProjectWorkflow(PROJECT_ID, deps)).resolves.toEqual({
      kind: 'audio',
      entryNodeId: ENTRY_ID,
      status: 'started',
      jobId: 'audio-attempt',
      attemptStatus: 'queued',
      reused: false,
      enqueuedNodeIds: [ENTRY_ID],
      repairRootNodeIds: [],
      failedNodeIds: [],
      blockedNodes: [],
    })
    expect(deps.enqueueAudio).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      nodeId: ENTRY_ID,
      workflowVersion: activeWorkflowVersionFor('audio'),
    })
  })

  it('dispatches website as one project-level attempt', async () => {
    const deps = dependencies('website')
    await expect(startProjectWorkflow(PROJECT_ID, deps)).resolves.toEqual({
      kind: 'website',
      entryNodeId: ENTRY_ID,
      status: 'started',
      jobId: 'website-attempt',
      attemptStatus: 'queued',
      reused: false,
      enqueuedNodeIds: [ENTRY_ID],
    })
    expect(deps.enqueueWebsite).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workflowVersion: activeWorkflowVersionFor('website'),
    })
  })

  it('resumes the established downstream frontier when ASR already succeeded', async () => {
    const deps = dependencies('audio')
    vi.mocked(deps.enqueueAudio).mockResolvedValue({
      attemptId: 'audio-attempt',
      status: 'succeeded',
      reused: true,
    })

    const result = await startProjectWorkflow(PROJECT_ID, deps)
    expect(result).toMatchObject({
      kind: 'audio',
      status: 'started',
      jobId: 'audio-attempt',
      attemptStatus: 'succeeded',
      reused: true,
      enqueuedNodeIds: [ENTRY_ID],
    })
    expect(result).not.toHaveProperty('autopilot')
    expect(deps.resumeAudio).toHaveBeenCalledWith(PROJECT_ID)
    expect(deps.startScript).not.toHaveBeenCalled()
  })

  it('leaves succeeded website delivery truth to the execution snapshot', async () => {
    const deps = dependencies('website')
    vi.mocked(deps.enqueueWebsite).mockResolvedValue({
      attemptId: 'website-attempt',
      status: 'succeeded',
      reused: true,
    })

    await expect(startProjectWorkflow(PROJECT_ID, deps)).resolves.toEqual({
      kind: 'website',
      entryNodeId: ENTRY_ID,
      status: 'started',
      jobId: 'website-attempt',
      attemptStatus: 'succeeded',
      reused: true,
      enqueuedNodeIds: [],
    })
    expect(deps.startScript).not.toHaveBeenCalled()
  })

  it('rejects a non-UUID path before looking up any project', async () => {
    const deps = dependencies('script')
    await expect(startProjectWorkflow('../other', deps)).rejects.toThrow()
    expect(deps.loadDescriptor).not.toHaveBeenCalled()
  })
})
