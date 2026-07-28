import { describe, expect, it, vi } from 'vitest'
import type { QueueAdapter, QueueJob } from '@/lib/queue'
import {
  EXPORT_PROJECT_KIND,
  enqueueProjectExport,
  registerExportProjectHandler,
  runProjectExport,
} from './export-queue-handler'

vi.mock('server-only', () => ({}))

function queueStub() {
  const handlers = new Map<string, (job: QueueJob) => Promise<void>>()
  const enqueue = vi.fn(async () => 'job-1')
  const adapter: QueueAdapter = {
    enqueue,
    register: (kind, handler) => handlers.set(kind, handler),
    start: () => {},
    stop: () => {},
  }
  return { adapter, handlers, enqueue }
}

function job(payload: Record<string, unknown>): QueueJob {
  return {
    id: 'job-1',
    kind: EXPORT_PROJECT_KIND,
    status: 'running',
    payload,
    attempts: 1,
  }
}

describe('enqueueProjectExport', () => {
  it('enqueues a project-scoped attempt by omitting nodeId', async () => {
    const { adapter, enqueue } = queueStub()

    await expect(
      enqueueProjectExport({ projectId: 'project-1' }, adapter)
    ).resolves.toBe('job-1')
    expect(enqueue).toHaveBeenCalledWith(
      EXPORT_PROJECT_KIND,
      { projectId: 'project-1' },
      { projectId: 'project-1' }
    )
  })

  it('rejects an untrusted payload before touching the queue', async () => {
    const { adapter, enqueue } = queueStub()

    await expect(
      enqueueProjectExport({ projectId: '' }, adapter)
    ).rejects.toThrow()
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('runProjectExport', () => {
  function awaitDeps(
    snapshots: Array<{ status: string; error?: string } | null>
  ) {
    const queued = [...snapshots]
    return {
      enqueue: vi.fn(async () => 'job-1'),
      getJobSnapshot: vi.fn(async () => (queued.shift() ?? null) as never),
      wait: vi.fn(async () => {}),
      maxPolls: 5,
    }
  }

  it('resolves once the export job reaches done', async () => {
    const deps = awaitDeps([{ status: 'pending' }, { status: 'done' }])

    await expect(runProjectExport('project-1', deps)).resolves.toBeUndefined()
    expect(deps.enqueue).toHaveBeenCalledWith({ projectId: 'project-1' })
    expect(deps.wait).toHaveBeenCalledTimes(1)
  })

  it('propagates the job failure message', async () => {
    const deps = awaitDeps([{ status: 'failed', error: '配乐 artifact 文件不存在' }])

    await expect(runProjectExport('project-1', deps)).rejects.toThrow(
      '配乐 artifact 文件不存在'
    )
  })

  it('reports an honest timeout instead of pretending success', async () => {
    const deps = awaitDeps([])

    await expect(runProjectExport('project-1', deps)).rejects.toThrow(
      '未在预期时间内完成'
    )
    expect(deps.getJobSnapshot).toHaveBeenCalledTimes(5)
  })
})

describe('registerExportProjectHandler', () => {
  it('runs the export for the payload project', async () => {
    const { adapter, handlers } = queueStub()
    const exportProject = vi.fn(async () => ({
      ok: true as const,
      artifactId: 'artifact-1',
      outputKey: 'exports/final.mp4',
      contentHash: 'a'.repeat(64),
    }))
    const exportDegradedProject = vi.fn()
    registerExportProjectHandler(adapter, {
      exportProject,
      exportDegradedProject: exportDegradedProject as never,
    })

    await handlers.get(EXPORT_PROJECT_KIND)?.(job({ projectId: 'project-1' }))

    expect(exportProject).toHaveBeenCalledWith('project-1')
    expect(exportDegradedProject).not.toHaveBeenCalled()
  })

  it('routes a degraded payload to the degraded export path', async () => {
    const { adapter, handlers } = queueStub()
    const exportProject = vi.fn()
    const exportDegradedProject = vi.fn(async () => ({
      ok: true as const,
      artifactId: 'artifact-degraded',
      outputKey: 'exports/final.mp4',
      contentHash: 'a'.repeat(64),
      placeholderLanes: ['S007'],
    }))
    registerExportProjectHandler(adapter, {
      exportProject: exportProject as never,
      exportDegradedProject,
    })

    await handlers.get(EXPORT_PROJECT_KIND)?.(
      job({ projectId: 'project-1', degraded: true })
    )

    expect(exportDegradedProject).toHaveBeenCalledWith('project-1', {
      repository: expect.anything(),
    })
    expect(exportProject).not.toHaveBeenCalled()
  })

  it('fails the attempt with the incomplete nodes when the project is not exportable', async () => {
    const { adapter, handlers } = queueStub()
    const exportProject = vi.fn(async () => ({
      ok: false as const,
      incompleteNodeIds: ['node-a', 'node-b'],
    }))
    registerExportProjectHandler(adapter, {
      exportProject,
      exportDegradedProject: vi.fn() as never,
    })

    await expect(
      handlers.get(EXPORT_PROJECT_KIND)?.(job({ projectId: 'project-1' }))
    ).rejects.toThrow('node-a、node-b')
  })

  it('fails with lane-scoped media reasons when artifacts block assembly', async () => {
    const { adapter, handlers } = queueStub()
    const exportProject = vi.fn(async () => ({
      ok: false as const,
      incompleteNodeIds: [],
      blockingIssues: [
        {
          laneKey: 'S003',
          kind: 'subtitle' as const,
          code: 'artifact-invalid' as const,
        },
      ],
    }))
    registerExportProjectHandler(adapter, {
      exportProject,
      exportDegradedProject: vi.fn() as never,
    })

    await expect(
      handlers.get(EXPORT_PROJECT_KIND)?.(job({ projectId: 'project-1' }))
    ).rejects.toThrow('S003 字幕产物无效')
  })

  it('rejects an untrusted job payload', async () => {
    const { adapter, handlers } = queueStub()
    const exportProject = vi.fn()
    registerExportProjectHandler(adapter, {
      exportProject: exportProject as never,
      exportDegradedProject: vi.fn() as never,
    })

    await expect(
      handlers.get(EXPORT_PROJECT_KIND)?.(job({ projectId: 123 }))
    ).rejects.toThrow()
    expect(exportProject).not.toHaveBeenCalled()
  })
})
