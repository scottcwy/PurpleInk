import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { StorageAdapter } from '@/lib/storage'
import {
  buildBlackClipArgs,
  buildSilentNarrationArgs,
  generatePlaceholderNarration,
  generatePlaceholderVideo,
  placeholderNarrationKey,
  placeholderVideoKey,
} from './placeholder-clip'

vi.mock('server-only', () => ({}))

describe('buildBlackClipArgs', () => {
  it('produces a bitexact black clip matching the render encode profile', () => {
    const args = buildBlackClipArgs({
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 90,
      outputPath: '/tmp/out.mp4',
    })

    expect(args).toContain('lavfi')
    expect(args).toContain('color=c=black:s=1920x1080:r=30')
    expect(args).toEqual(
      expect.arrayContaining(['-frames:v', '90', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'])
    )
    expect(args).toContain('+bitexact')
    expect(args[args.length - 1]).toBe('/tmp/out.mp4')
  })
})

describe('buildSilentNarrationArgs', () => {
  it('renders a 48kHz stereo silent track for the requested duration', () => {
    const args = buildSilentNarrationArgs({ durationMs: 2500, outputPath: '/tmp/s.wav' })

    expect(args).toContain('anullsrc=r=48000:cl=stereo')
    expect(args).toEqual(expect.arrayContaining(['-t', '2.5', '-c:a', 'pcm_s16le']))
    expect(args[args.length - 1]).toBe('/tmp/s.wav')
  })
})

describe('generatePlaceholderVideo', () => {
  const params = { width: 1920, height: 1080, fps: 30, durationInFrames: 60 }

  it('reuses an existing deterministic clip without invoking ffmpeg', async () => {
    const bytes = Buffer.from('cached-black-clip')
    const storage = createStorage()
    vi.mocked(storage.exists).mockResolvedValue(true)
    vi.mocked(storage.get).mockResolvedValue(bytes)
    const runFfmpeg = vi.fn()

    const ref = await generatePlaceholderVideo(
      { projectId: 'p1', laneKey: 'S007', params },
      { storage, runFfmpeg }
    )

    expect(runFfmpeg).not.toHaveBeenCalled()
    expect(storage.put).not.toHaveBeenCalled()
    expect(ref.storageKey).toBe(placeholderVideoKey('p1', 'S007', params))
    expect(ref.contentHash).toHaveLength(64)
    expect(ref.artifactId).toBe('placeholder-video:S007')
  })

  it('generates, hashes and stores a new clip when none exists', async () => {
    const bytes = Buffer.from('fresh-black-clip-bytes')
    const storage = createStorage()
    vi.mocked(storage.exists).mockResolvedValue(false)
    vi.mocked(storage.tempDir).mockResolvedValue('/tmp/work')
    vi.mocked(storage.readLocalFile).mockResolvedValue(bytes)
    const runFfmpeg = vi.fn(async () => {})

    const ref = await generatePlaceholderVideo(
      { projectId: 'p1', laneKey: 'S007', params },
      { storage, runFfmpeg }
    )

    expect(runFfmpeg).toHaveBeenCalledOnce()
    expect(storage.put).toHaveBeenCalledWith(ref.storageKey, bytes)
    expect(storage.removeTempDir).toHaveBeenCalledWith('/tmp/work')
    expect(ref.contentHash).toBe(sha256(bytes))
  })
})

describe('generatePlaceholderNarration', () => {
  it('stores a silent track keyed by lane and duration', async () => {
    const bytes = Buffer.from('silence')
    const storage = createStorage()
    vi.mocked(storage.exists).mockResolvedValue(false)
    vi.mocked(storage.tempDir).mockResolvedValue('/tmp/work')
    vi.mocked(storage.readLocalFile).mockResolvedValue(bytes)
    const runFfmpeg = vi.fn(async () => {})

    const ref = await generatePlaceholderNarration(
      { projectId: 'p1', laneKey: 'S007', durationMs: 2000 },
      { storage, runFfmpeg }
    )

    expect(ref.storageKey).toBe(placeholderNarrationKey('p1', 'S007', 2000))
    expect(ref.artifactId).toBe('placeholder-narration:S007')
    expect(runFfmpeg).toHaveBeenCalledOnce()
  })
})

function createStorage(): StorageAdapter {
  return {
    put: vi.fn(async (key: string) => key),
    get: vi.fn(),
    exists: vi.fn(),
    localPath: vi.fn(),
    delete: vi.fn(),
    tempDir: vi.fn(),
    readLocalFile: vi.fn(),
    removeTempDir: vi.fn(async () => {}),
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
