import os from 'node:os'
import path from 'node:path'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrameCaptureSession } from './frame-capture'
import { captureSequence } from './frame-sequence'

vi.mock('server-only', () => ({}))

const roots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('captureSequence', () => {
  it('limits active captures and returns a cleanup-owned disk sequence', async () => {
    const tempRoot = await createTempRoot()
    let active = 0
    let peak = 0
    const openCapture = vi.fn(async (): Promise<FrameCaptureSession> => ({
      async capture(frame) {
        active += 1
        peak = Math.max(peak, active)
        await Promise.resolve()
        active -= 1
        return Buffer.from(`png-${frame}`)
      },
      close: vi.fn(async () => {}),
    }))

    const sequence = await captureSequence('shot.html', 6, 30, {
      concurrency: 2,
      tempRoot,
      openCapture,
    })

    expect(peak).toBeLessThanOrEqual(2)
    expect(openCapture).toHaveBeenCalledTimes(2)
    expect(await readdir(sequence.directory)).toHaveLength(6)
    await sequence.cleanup()
    await expect(stat(sequence.directory)).rejects.toThrow()
  })

  it('reports the failed frame and removes the partial directory', async () => {
    const tempRoot = await createTempRoot()
    const openCapture = vi.fn(async (): Promise<FrameCaptureSession> => ({
      async capture(frame) {
        if (frame === 2) throw new Error('截图异常')
        return Buffer.from(`png-${frame}`)
      },
      close: vi.fn(async () => {}),
    }))

    await expect(
      captureSequence('shot.html', 5, 30, {
        concurrency: 2,
        tempRoot,
        openCapture,
      })
    ).rejects.toThrow('第 2 帧')
    expect(await readdir(tempRoot)).toEqual([])
  })
})

async function createTempRoot(): Promise<string> {
  const root = path.join(os.tmpdir(), `cvc-frame-sequence-${crypto.randomUUID()}`)
  roots.push(root)
  await mkdir(root, { recursive: true })
  return root
}
