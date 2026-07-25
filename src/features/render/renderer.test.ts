import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StorageAdapter } from '@/lib/storage'
import type { FrameSequence } from './frame-sequence'
import { HyperframesRenderer } from './renderer'
import type { RenderJob } from './types'

vi.mock('server-only', () => ({}))

const job: RenderJob = {
  projectId: 'project-1',
  nodeId: 'node-1',
  shotId: 'S001',
  htmlKey: 'director/S001.html',
  frames: { fps: 30, durationInFrames: 60, width: 1920, height: 1080 },
  seed: 7,
}
const directories: string[] = []

describe('HyperframesRenderer', () => {
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    )
  })

  it('returns a cache hit without capturing frames', async () => {
    const captureSequence = vi.fn()
    const renderer = new HyperframesRenderer({
      storage: createStorage('<html>deterministic</html>'),
      lookupCache: vi.fn(async () => ({
        outputKey: 'render/cached.mp4',
        contentHash: 'cached-hash',
      })),
      writeCache: vi.fn(),
      captureSequence,
      encode: vi.fn(),
    })

    await expect(renderer.render(job)).resolves.toEqual({
      shotId: 'S001',
      outputKey: 'render/cached.mp4',
      contentHash: 'cached-hash',
    })
    expect(captureSequence).not.toHaveBeenCalled()
  })

  it('captures, encodes, commits, indexes, and cleans a cache miss in order', async () => {
    const tempRoot = await createTempRoot()
    const order: string[] = []
    const cleanup = vi.fn(async () => {
      order.push('cleanup')
    })
    const sequence: FrameSequence = {
      directory: path.join(tempRoot, 'frames'),
      pattern: path.join(tempRoot, 'frames/frame-%08d.png'),
      totalFrames: 60,
      cleanup,
    }
    const storage = createStorage('<html>deterministic</html>')
    vi.mocked(storage.put).mockImplementation(async (key) => {
      order.push('store')
      return key
    })
    const renderer = new HyperframesRenderer({
      storage,
      lookupCache: vi.fn(async () => null),
      captureSequence: vi.fn(async () => {
        order.push('capture')
        return sequence
      }),
      encode: vi.fn(async (_sequence, _fps, outputPath) => {
        order.push('encode')
        await writeFile(outputPath, Buffer.from('mp4'))
        return outputPath
      }),
      writeCache: vi.fn(async () => {
        order.push('index')
        return 'artifact-1'
      }),
      tempRoot,
    })

    const result = await renderer.render(job)

    expect(result.outputKey).toMatch(/^render\/project-1\/node-1\/[a-f0-9]{64}\.mp4$/)
    expect(result.contentHash).toBe(
      createHash('sha256').update(Buffer.from('mp4')).digest('hex')
    )
    expect(order).toEqual(['capture', 'encode', 'store', 'index', 'cleanup'])
  })

  it('blocks forbidden HTML before capture or encode', async () => {
    const captureSequence = vi.fn()
    const encode = vi.fn()
    const renderer = new HyperframesRenderer({
      storage: createStorage('<script>requestAnimationFrame(render)</script>'),
      lookupCache: vi.fn(),
      writeCache: vi.fn(),
      captureSequence,
      encode,
    })

    await expect(renderer.render(job)).rejects.toThrow('确定性违规')
    expect(captureSequence).not.toHaveBeenCalled()
    expect(encode).not.toHaveBeenCalled()
  })
})

function createStorage(html: string): StorageAdapter {
  return {
    put: vi.fn(),
    get: vi.fn(async () => Buffer.from(html)),
    exists: vi.fn(),
    localPath: vi.fn(() => 'shot.html'),
    delete: vi.fn(),
    tempDir: vi.fn(),
    readLocalFile: vi.fn(),
    removeTempDir: vi.fn(),
  }
}

async function createTempRoot(): Promise<string> {
  const directory = path.join(os.tmpdir(), `cvc-renderer-${crypto.randomUUID()}`)
  directories.push(directory)
  await mkdir(directory, { recursive: true })
  return directory
}
