import os from 'node:os'
import path from 'node:path'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { LocalFsStorage } from '@/lib/storage'
import { HyperframesRenderer } from './renderer'
import type { RenderJob } from './types'

vi.mock('server-only', () => ({}))

const root = path.join(os.tmpdir(), `cvc-render-e2e-${crypto.randomUUID()}`)
const storage = new LocalFsStorage(path.join(root, 'artifacts'))
const job: RenderJob = {
  projectId: 'project-e2e',
  nodeId: 'node-e2e',
  shotId: 'S001',
  htmlKey: 'director/S001.html',
  frames: { fps: 24, durationInFrames: 6, width: 320, height: 180 },
  seed: 42,
}

describe('HyperframesRenderer integration', () => {
  beforeAll(async () => {
    await mkdir(root, { recursive: true })
    const fixture = await readFile(
      new URL('./__fixtures__/deterministic-shot.html', import.meta.url)
    )
    await storage.put(job.htmlKey, fixture)
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('renders identical mp4 bytes for identical trusted input', async () => {
    const renderer = new HyperframesRenderer({
      storage,
      lookupCache: async () => null,
      writeCache: async () => 'artifact-e2e',
      tempRoot: path.join(root, 'temp'),
    })

    const first = await renderer.render(job)
    const firstBytes = await storage.get(first.outputKey)
    const second = await renderer.render(job)
    const secondBytes = await storage.get(second.outputKey)

    expect(second).toEqual(first)
    expect(secondBytes.equals(firstBytes)).toBe(true)
    expect(firstBytes.length).toBeGreaterThan(0)
  }, 30_000)
})
