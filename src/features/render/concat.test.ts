import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ffmpegPath from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { captureFrame } from './frame-capture'
import { encodeToMp4 } from './encode'
import type { FrameSequence } from './frame-sequence'
import { concatExport } from './concat'

vi.mock('server-only', () => ({}))

describe('concatExport', () => {
  let directory: string
  let clips: string[]

  beforeAll(async () => {
    directory = path.join(os.tmpdir(), `cvc-concat-${randomUUID()}`)
    const framesDirectory = path.join(directory, 'frames')
    await mkdir(framesDirectory, { recursive: true })
    const fixture = fileURLToPath(
      new URL('./__fixtures__/deterministic-shot.html', import.meta.url)
    )
    const png = await captureFrame(fixture, 18, 30)
    await Promise.all(
      Array.from({ length: 6 }, (_, frame) =>
        writeFile(
          path.join(framesDirectory, `frame-${String(frame).padStart(8, '0')}.png`),
          png
        )
      )
    )
    const sequence: FrameSequence = {
      directory: framesDirectory,
      pattern: path.join(framesDirectory, 'frame-%08d.png'),
      totalFrames: 6,
      cleanup: vi.fn(async () => {}),
    }
    const source = await encodeToMp4(sequence, 30, path.join(directory, 'source.mp4'))
    clips = await Promise.all(
      ['a.mp4', 'b.mp4', 'c.mp4'].map(async (name) => {
        const target = path.join(directory, name)
        await copyFile(source, target)
        return target
      })
    )
  }, 30_000)

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('stream-concats clips to approximately their summed duration', async () => {
    const output = path.join(directory, 'joined.mp4')
    await concatExport(clips, null, output)

    const expected = (await Promise.all(clips.map(probeDuration))).reduce(
      (sum, duration) => sum + duration,
      0
    )
    const actual = await probeDuration(output)
    // concat demuxer may round at most one frame per segment.
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(3 / 30)
    expect(createHash('sha256').update(await readFile(output)).digest('hex')).toHaveLength(64)
  }, 20_000)

  it('identifies the missing shot index before starting concat', async () => {
    await expect(
      concatExport(
        [clips[0]!, path.join(directory, 'missing.mp4'), clips[2]!],
        null,
        path.join(directory, 'failure.mp4')
      )
    ).rejects.toThrow('分镜索引 1')
  })

  it('re-encodes to a non-master resolution via the scale filter', async () => {
    const output = path.join(directory, 'scaled.mp4')
    await concatExport(clips, null, output, { width: 540, height: 960 })
    expect(await probeResolution(output)).toEqual({ width: 540, height: 960 })
  }, 30_000)
})

function probeDuration(file: string): Promise<number> {
  const executable = ffmpegPath
  if (!executable) throw new Error('ffmpeg-static unavailable')
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-hide_banner', '-i', file, '-f', 'null', '-'], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('close', () => {
      const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
      if (!match) reject(new Error(`无法读取时长：${stderr}`))
      else resolve(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]))
    })
  })
}

function probeResolution(file: string): Promise<{ width: number; height: number }> {
  const executable = ffmpegPath
  if (!executable) throw new Error('ffmpeg-static unavailable')
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-hide_banner', '-i', file, '-f', 'null', '-'], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('close', () => {
      // 区分分辨率 540x960 与编解码器 tag 0x31637661：宽高限定 2-4 位数字。
      const match = /\b(\d{2,4})x(\d{2,4})\b/.exec(stderr)
      if (!match) reject(new Error(`无法读取分辨率：${stderr}`))
      else resolve({ width: Number(match[1]), height: Number(match[2]) })
    })
  })
}
