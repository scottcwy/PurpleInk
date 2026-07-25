import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { checkSource } from '@/lib/determinism'
import { captureFrame, openFrameCapture } from './frame-capture'

vi.mock('server-only', () => ({}))

const fixturePath = fileURLToPath(
  new URL('./__fixtures__/deterministic-shot.html', import.meta.url)
)
const invalidRuntimePath = fileURLToPath(
  new URL('./__fixtures__/invalid-runtime.html', import.meta.url)
)

describe('frame capture', () => {
  it('captures identical PNG bytes for the same frame', async () => {
    const first = await captureFrame(fixturePath, 24, 30)
    const second = await captureFrame(fixturePath, 24, 30)

    expect(hash(first)).toBe(hash(second))
    expect(first.subarray(1, 4).toString('ascii')).toBe('PNG')
  }, 30_000)

  it('changes pixels when the requested frame changes', async () => {
    const capture = await openFrameCapture(fixturePath)
    try {
      const start = await capture.capture(0, 30)
      const end = await capture.capture(60, 30)
      expect(hash(start)).not.toBe(hash(end))
    } finally {
      await capture.close()
    }
  }, 20_000)

  it('rejects a mismatched shot runtime version', async () => {
    await expect(openFrameCapture(invalidRuntimePath)).rejects.toThrow(
      '__CVC_RENDER__ runtime version'
    )
  }, 10_000)

  it('keeps the deterministic fixture free of forbidden sources', async () => {
    const source = await readFile(fixturePath, 'utf8')
    expect(checkSource(source)).toEqual([])
  })
})

function hash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
