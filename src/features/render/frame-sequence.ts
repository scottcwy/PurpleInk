import 'server-only'
import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import {
  openFrameCapture,
  type FrameCaptureOptions,
  type FrameCaptureSession,
} from './frame-capture'

export interface FrameSequence {
  directory: string
  pattern: string
  totalFrames: number
  cleanup(): Promise<void>
}

export interface CaptureSequenceOptions extends FrameCaptureOptions {
  concurrency?: number
  tempRoot?: string
  openCapture?: (
    htmlPath: string,
    options?: FrameCaptureOptions
  ) => Promise<FrameCaptureSession>
}

export async function captureSequence(
  htmlPath: string,
  totalFrames: number,
  fps: number,
  options: CaptureSequenceOptions = {}
): Promise<FrameSequence> {
  validateInput(totalFrames, fps, options.concurrency)
  const root = options.tempRoot ?? os.tmpdir()
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(path.join(root, 'cvc-frames-'))
  const workerCount = Math.min(options.concurrency ?? 2, totalFrames)
  const openCapture = options.openCapture ?? openFrameCapture
  let nextFrame = 0
  let failure: Error | undefined

  const workers = Array.from({ length: workerCount }, async () => {
    let session: FrameCaptureSession | undefined
    try {
      session = await openCapture(htmlPath, {
        width: options.width,
        height: options.height,
      })
      while (!failure) {
        const frame = nextFrame
        nextFrame += 1
        if (frame >= totalFrames) return
        try {
          const png = await session.capture(frame, fps)
          await writeFile(framePath(directory, frame), png)
        } catch (error) {
          failure ??= new Error(`第 ${frame} 帧截图失败：${messageOf(error)}`, {
            cause: error,
          })
        }
      }
    } catch (error) {
      failure ??= new Error(`打开截图 session 失败：${messageOf(error)}`, {
        cause: error,
      })
    } finally {
      if (session) {
        try {
          await session.close()
        } catch (error) {
          failure ??= new Error(`关闭截图 session 失败：${messageOf(error)}`, {
            cause: error,
          })
        }
      }
    }
  })

  await Promise.all(workers)
  if (failure) {
    await rm(directory, { recursive: true, force: true })
    throw failure
  }
  return createSequence(directory, totalFrames)
}

function createSequence(directory: string, totalFrames: number): FrameSequence {
  let cleaned = false
  return {
    directory,
    pattern: path.join(directory, 'frame-%08d.png'),
    totalFrames,
    async cleanup() {
      if (cleaned) return
      cleaned = true
      await rm(directory, { recursive: true, force: true })
    },
  }
}

function framePath(directory: string, frame: number): string {
  return path.join(directory, `frame-${String(frame).padStart(8, '0')}.png`)
}

function validateInput(
  totalFrames: number,
  fps: number,
  concurrency: number | undefined
): void {
  if (!Number.isInteger(totalFrames) || totalFrames < 1) {
    throw new Error(`totalFrames 必须是正整数：${totalFrames}`)
  }
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`fps 必须大于 0：${fps}`)
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) {
    throw new Error(`concurrency 必须是正整数：${concurrency}`)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
