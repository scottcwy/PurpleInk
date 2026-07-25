import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureFrame } from './frame-capture'
import type { FrameSequence } from './frame-sequence'
import { encodeToMp4 } from './encode'

vi.mock('server-only', () => ({}))

describe('encodeToMp4', () => {
  let directory: string
  let sequence: FrameSequence
  let png: Buffer

  beforeAll(async () => {
    const fixture = fileURLToPath(
      new URL('./__fixtures__/deterministic-shot.html', import.meta.url)
    )
    png = await captureFrame(fixture, 12, 30)
  }, 20_000)

  beforeEach(async () => {
    directory = path.join(os.tmpdir(), `cvc-encode-${randomUUID()}`)
    const framesDirectory = path.join(directory, 'frames')
    await mkdir(framesDirectory, { recursive: true })
    await Promise.all(
      Array.from({ length: 3 }, (_, frame) =>
        writeFile(
          path.join(framesDirectory, `frame-${String(frame).padStart(8, '0')}.png`),
          png
        )
      )
    )
    sequence = {
      directory: framesDirectory,
      pattern: path.join(framesDirectory, 'frame-%08d.png'),
      totalFrames: 3,
      cleanup: vi.fn(async () => {}),
    }
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('produces byte-identical mp4 files from the same frame sequence', async () => {
    const first = path.join(directory, 'first.mp4')
    const second = path.join(directory, 'second.mp4')

    await encodeToMp4(sequence, 30, first)
    await encodeToMp4(sequence, 30, second)

    expect(await fileHash(first)).toBe(await fileHash(second))
    expect((await readdir(directory)).some((name) => name.includes('.tmp-'))).toBe(false)
  }, 30_000)

  it('includes ffmpeg stderr when encoding fails', async () => {
    const missing: FrameSequence = {
      ...sequence,
      pattern: path.join(directory, 'missing-%08d.png'),
    }

    await expect(
      encodeToMp4(missing, 30, path.join(directory, 'failure.mp4'))
    ).rejects.toThrow(/ffmpeg.*(No such file|Could find no file)/i)
  }, 15_000)
})

async function fileHash(file: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  return createHash('sha256').update(await readFile(file)).digest('hex')
}
