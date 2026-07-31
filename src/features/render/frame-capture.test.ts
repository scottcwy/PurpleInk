import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'
import { describe, expect, it, vi } from 'vitest'
import { checkSource } from '@/lib/determinism'
import {
  captureFrame,
  openFrameCapture,
  seekFrameRuntime,
} from './frame-capture'

vi.mock('server-only', () => ({}))

const fixturePath = fileURLToPath(
  new URL('./__fixtures__/deterministic-shot.html', import.meta.url)
)
const invalidRuntimePath = fileURLToPath(
  new URL('./__fixtures__/invalid-runtime.html', import.meta.url)
)
const portraitCanvasPath = fileURLToPath(
  new URL('./__fixtures__/portrait-canvas.html', import.meta.url)
)
const runtimePageErrorPath = fileURLToPath(
  new URL('./__fixtures__/runtime-page-error.html', import.meta.url)
)
const runtimeSeekErrorPath = fileURLToPath(
  new URL('./__fixtures__/runtime-seek-error.html', import.meta.url)
)
const runtimeAsyncSeekErrorPath = fileURLToPath(
  new URL('./__fixtures__/runtime-async-seek-error.html', import.meta.url)
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

  it('rejects runtime geometry that is not the 1920×1080 master canvas', async () => {
    await expect(openFrameCapture(portraitCanvasPath)).rejects.toThrow(
      '母版画布几何不匹配'
    )
  }, 10_000)

  it('rejects a page script error even when runtime and geometry exist', async () => {
    await expect(openFrameCapture(runtimePageErrorPath)).rejects.toThrow(
      'shot 页面脚本执行失败'
    )
  }, 10_000)

  it('rejects a runtime script error raised during seek', async () => {
    const capture = await openFrameCapture(runtimeSeekErrorPath)
    try {
      await expect(capture.capture(1, 30)).rejects.toThrow(
        'shot 页面脚本执行失败'
      )
    } finally {
      await capture.close()
    }
  }, 10_000)

  it('rejects an asynchronous page error raised during seek', async () => {
    const capture = await openFrameCapture(runtimeAsyncSeekErrorPath)
    try {
      await expect(capture.capture(1, 30)).rejects.toThrow(
        'shot 页面脚本执行失败'
      )
    } finally {
      await capture.close()
    }
  }, 10_000)

  it('preserves Playwright infrastructure failures raised during seek', async () => {
    const failure = new Error('browser process unavailable')
    const page = {
      evaluate: vi.fn(async () => {
        throw failure
      }),
    } as unknown as Page

    await expect(seekFrameRuntime(page, 1, 30)).rejects.toBe(failure)
  })

  it('keeps the deterministic fixture free of forbidden sources', async () => {
    const source = await readFile(fixturePath, 'utf8')
    expect(checkSource(source)).toEqual([])
  })
})

function hash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
