import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { FileStateStore } from './file-store'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('FileStateStore', () => {
  it('writes runs atomically and keeps append-only events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-cli-state-'))
    roots.push(root)
    const store = new FileStateStore(root)
    const run = await store.createRun({
      inputHash: 'a'.repeat(64),
      title: 'Demo',
      workflowVersion: 'script-video-v1',
    })

    expect(run.runId).toMatch(/^\d{8}T\d{6}Z-a{12}$/u)
    expect((await store.readRun(run.runDir)).inputHash).toBe('a'.repeat(64))

    await store.appendEvent(run.runDir, { type: 'run.started', data: { stage: 'INGEST' } })
    await store.appendEvent(run.runDir, { type: 'stage.succeeded', data: { stage: 'INGEST' } })
    const rawEvents = await readFile(join(run.runDir, 'state', 'events.jsonl'), 'utf8')
    expect(rawEvents.trim().split('\n')).toHaveLength(2)
    expect(JSON.parse(rawEvents.split('\n')[0]!)).toMatchObject({ type: 'run.started' })
  })

  it('preserves completed stages and rejects a different input on resume', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-cli-state-'))
    roots.push(root)
    const store = new FileStateStore(root)
    const run = await store.createRun({
      inputHash: 'b'.repeat(64),
      title: 'Demo',
      workflowVersion: 'script-video-v1',
    })

    await store.writeStage(run.runDir, {
      key: 'shot-S001',
      status: 'succeeded',
      attempt: 1,
      fingerprint: 'c'.repeat(64),
      payload: { html: 'ready' },
    })
    expect(await store.readStage(run.runDir, 'shot-S001')).toMatchObject({
      status: 'succeeded',
      attempt: 1,
    })

    await expect(
      store.assertResumeCompatible(run.runDir, {
        inputHash: 'd'.repeat(64),
        workflowVersion: 'script-video-v1',
      }),
    ).rejects.toThrow(/hash/i)
  })
})
