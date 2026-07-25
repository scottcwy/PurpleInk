import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { FrameCaptureSession } from './frame-capture'
import { captureThumbnails, fractionToFrame, thumbnailSourceKey } from './thumbnail'
import type { ThumbnailArtifactRecord, ThumbnailContext } from './types'

vi.mock('server-only', () => ({}))

const context: ThumbnailContext = {
  projectId: 'project-1',
  nodeId: 'node-1',
  htmlKey: 'director/S001.html',
  frames: { fps: 30, durationInFrames: 60, width: 1920, height: 1080 },
}

describe('fractionToFrame', () => {
  it('maps 0% to the first frame and 100% to the last frame', () => {
    expect(fractionToFrame(0, 60)).toBe(0)
    expect(fractionToFrame(1, 60)).toBe(59)
  })

  it('rounds intermediate fractions without going out of bounds', () => {
    expect(fractionToFrame(0.25, 60)).toBe(15)
    expect(fractionToFrame(0.6, 60)).toBe(35)
    expect(fractionToFrame(0.95, 60)).toBe(56)
  })

  it('rejects out-of-range fractions and non-positive durations', () => {
    expect(() => fractionToFrame(-0.1, 60)).toThrow('fraction')
    expect(() => fractionToFrame(1.1, 60)).toThrow('fraction')
    expect(() => fractionToFrame(0.5, 0)).toThrow('durationInFrames')
  })
})

describe('thumbnailSourceKey', () => {
  it('changes when the HTML content changes', () => {
    const first = thumbnailSourceKey(Buffer.from('<html>a</html>'), context.frames)
    const second = thumbnailSourceKey(Buffer.from('<html>b</html>'), context.frames)
    expect(first).not.toBe(second)
  })

  it('changes when the frame spec changes', () => {
    const html = Buffer.from('<html>a</html>')
    const first = thumbnailSourceKey(html, context.frames)
    const second = thumbnailSourceKey(html, { ...context.frames, fps: 24 })
    expect(first).not.toBe(second)
  })

  it('is stable for identical inputs', () => {
    const html = Buffer.from('<html>a</html>')
    expect(thumbnailSourceKey(html, context.frames)).toBe(
      thumbnailSourceKey(html, context.frames)
    )
  })
})

describe('captureThumbnails', () => {
  it('does not open a capture session when every target frame is cached', async () => {
    const openCapture = vi.fn()
    const record: ThumbnailArtifactRecord = {
      artifactId: 'artifact-1',
      path: 'thumbnails/project-1/node-1/key/frame-00000015.png',
      contentHash: 'hash-1',
    }
    const storage = createStorage({ exists: async () => true })
    const repository = {
      findThumbnail: vi.fn(async () => record),
      registerThumbnail: vi.fn(async () => 'unused'),
    }

    const results = await captureThumbnails(context, [{ fraction: 0.25 }], {
      storage,
      repository,
      openCapture,
    })

    expect(openCapture).not.toHaveBeenCalled()
    expect(results).toEqual([
      { fraction: 0.25, frame: 15, artifactId: 'artifact-1', contentHash: 'hash-1' },
    ])
  })

  it('re-captures a frame whose cached artifact file is missing on disk', async () => {
    const record: ThumbnailArtifactRecord = {
      artifactId: 'artifact-stale',
      path: 'thumbnails/project-1/node-1/key/frame-00000015.png',
      contentHash: 'hash-stale',
    }
    const session = createSession()
    const openCapture = vi.fn(async () => session)
    const storage = createStorage({ exists: async () => false })
    const repository = {
      findThumbnail: vi.fn(async () => record),
      registerThumbnail: vi.fn(async () => 'artifact-new'),
    }

    const results = await captureThumbnails(context, [{ fraction: 0.25 }], {
      storage,
      repository,
      openCapture,
    })

    expect(openCapture).toHaveBeenCalledTimes(1)
    expect(results[0]?.artifactId).toBe('artifact-new')
  })

  it('opens exactly one session for multiple missing frames, captures serially in order, then closes once', async () => {
    const captureOrder: number[] = []
    const session: FrameCaptureSession = {
      capture: vi.fn(async (frame: number) => {
        captureOrder.push(frame)
        return Buffer.from(`png-${frame}`)
      }),
      close: vi.fn(async () => {}),
    }
    const openCapture = vi.fn(async () => session)
    const storage = createStorage({ exists: async () => false })
    let nextId = 0
    const repository = {
      findThumbnail: vi.fn(async () => null),
      registerThumbnail: vi.fn(async () => `artifact-${nextId++}`),
    }

    const results = await captureThumbnails(
      context,
      [{ fraction: 0.95 }, { fraction: 0 }, { fraction: 0.6 }],
      { storage, repository, openCapture }
    )

    expect(openCapture).toHaveBeenCalledTimes(1)
    expect(captureOrder).toEqual([0, 35, 56])
    expect(session.close).toHaveBeenCalledTimes(1)
    expect(results.map((result) => result.frame)).toEqual([56, 0, 35])
  })

  it('deduplicates identical target frames into a single capture', async () => {
    const session = createSession()
    const openCapture = vi.fn(async () => session)
    const storage = createStorage({ exists: async () => false })
    const repository = {
      findThumbnail: vi.fn(async () => null),
      registerThumbnail: vi.fn(async () => 'artifact-1'),
    }

    await captureThumbnails(context, [{ fraction: 0.25 }, { fraction: 0.25 }], {
      storage,
      repository,
      openCapture,
    })

    expect(session.capture).toHaveBeenCalledTimes(1)
    expect(repository.registerThumbnail).toHaveBeenCalledTimes(1)
  })

  it('writes the PNG, hashes it, and registers a frame-thumbnail artifact', async () => {
    const png = Buffer.from('fake-png-bytes')
    const session: FrameCaptureSession = {
      capture: vi.fn(async () => png),
      close: vi.fn(async () => {}),
    }
    const openCapture = vi.fn(async () => session)
    const storage = createStorage({ exists: async () => false })
    const repository = {
      findThumbnail: vi.fn(async () => null),
      registerThumbnail: vi.fn(async () => 'artifact-1'),
    }

    const results = await captureThumbnails(context, [{ fraction: 0.25 }], {
      storage,
      repository,
      openCapture,
    })

    const expectedHash = createHash('sha256').update(png).digest('hex')
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringContaining('thumbnails/project-1/node-1/'),
      png
    )
    expect(repository.registerThumbnail).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        nodeId: 'node-1',
        contentHash: expectedHash,
      })
    )
    expect(results[0]).toMatchObject({ contentHash: expectedHash, artifactId: 'artifact-1' })
  })

  it('deletes the written PNG and closes the session when artifact registration fails', async () => {
    const session = createSession()
    const openCapture = vi.fn(async () => session)
    const storage = createStorage({ exists: async () => false })
    const repository = {
      findThumbnail: vi.fn(async () => null),
      registerThumbnail: vi.fn(async () => {
        throw new Error('登记失败')
      }),
    }

    await expect(
      captureThumbnails(context, [{ fraction: 0.25 }], { storage, repository, openCapture })
    ).rejects.toThrow('登记失败')

    expect(storage.delete).toHaveBeenCalledTimes(1)
    expect(session.close).toHaveBeenCalledTimes(1)
  })

  it('closes the session even when a capture call throws', async () => {
    const session: FrameCaptureSession = {
      capture: vi.fn(async () => {
        throw new Error('截图异常')
      }),
      close: vi.fn(async () => {}),
    }
    const openCapture = vi.fn(async () => session)
    const storage = createStorage({ exists: async () => false })
    const repository = {
      findThumbnail: vi.fn(async () => null),
      registerThumbnail: vi.fn(async () => 'unused'),
    }

    await expect(
      captureThumbnails(context, [{ fraction: 0.25 }], { storage, repository, openCapture })
    ).rejects.toThrow('截图异常')

    expect(session.close).toHaveBeenCalledTimes(1)
  })
})

function createSession(): FrameCaptureSession {
  return {
    capture: vi.fn(async (frame: number) => Buffer.from(`png-${frame}`)),
    close: vi.fn(async () => {}),
  }
}

function createStorage(overrides: { exists: () => Promise<boolean> }) {
  return {
    put: vi.fn(async (key: string) => key),
    get: vi.fn(async () => Buffer.from('<html>deterministic</html>')),
    exists: vi.fn(overrides.exists),
    localPath: vi.fn((key: string) => key),
    delete: vi.fn(async () => {}),
    tempDir: vi.fn(async (prefix: string) => prefix),
    readLocalFile: vi.fn(async () => Buffer.from('')),
    removeTempDir: vi.fn(async () => {}),
  }
}
