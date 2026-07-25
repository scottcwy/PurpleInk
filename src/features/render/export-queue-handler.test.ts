import { describe, expect, it, vi } from 'vitest'
import type { QueueAdapter, QueueJob } from '@/lib/queue'
import {
  EXPORT_PROJECT_KIND,
  enqueueProjectExport,
  registerExportProjectHandler,
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

describe('registerExportProjectHandler', () => {
  it('runs the export for the payload project', async () => {
    const { adapter, handlers } = queueStub()
    const exportProject = vi.fn(async () => ({
      ok: true as const,
      artifactId: 'artifact-1',
      outputKey: 'exports/final.mp4',
      contentHash: 'a'.repeat(64),
    }))
    registerExportProjectHandler(adapter, { exportProject })

    await handlers.get(EXPORT_PROJECT_KIND)?.(job({ projectId: 'project-1' }))

    expect(exportProject).toHaveBeenCalledWith('project-1')
  })

  it('fails the attempt with the incomplete nodes when the project is not exportable', async () => {
    const { adapter, handlers } = queueStub()
    const exportProject = vi.fn(async () => ({
      ok: false as const,
      incompleteNodeIds: ['node-a', 'node-b'],
    }))
    registerExportProjectHandler(adapter, { exportProject })

    await expect(
      handlers.get(EXPORT_PROJECT_KIND)?.(job({ projectId: 'project-1' }))
    ).rejects.toThrow('node-a、node-b')
  })

  it('rejects an untrusted job payload', async () => {
    const { adapter, handlers } = queueStub()
    const exportProject = vi.fn()
    registerExportProjectHandler(adapter, {
      exportProject: exportProject as never,
    })

    await expect(
      handlers.get(EXPORT_PROJECT_KIND)?.(job({ projectId: 123 }))
    ).rejects.toThrow()
    expect(exportProject).not.toHaveBeenCalled()
  })
})
