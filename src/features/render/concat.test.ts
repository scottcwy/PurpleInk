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
import type { MediaAssemblyPlan } from './media-assembly'
import { buildAssDocument } from '@/features/audio/subtitle-ass'

vi.mock('server-only', () => ({}))

describe('concatExport', () => {
  let directory: string
  let clips: string[]
  let narrationPaths: string[]

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
    narrationPaths = await Promise.all(
      ['narration-a.mp3', 'narration-b.mp3', 'narration-c.mp3'].map(
        async (name, index) => {
          const target = path.join(directory, name)
          await generateTone(target, 440 + index * 110)
          return target
        }
      )
    )
  }, 30_000)

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('assembles H.264 video, AAC narration and hard subtitles to the exact frame duration', async () => {
    const output = path.join(directory, 'joined.mp4')
    const plan = assemblyPlan({ width: 1920, height: 1080 })
    await concatExport(
      plan,
      { videoPaths: clips, narrationPaths, musicPath: null },
      subtitleAss(plan),
      output
    )

    const actual = await probeDuration(output)
    expect(Math.abs(actual - plan.totalFrames / plan.fps)).toBeLessThanOrEqual(
      1 / plan.fps
    )
    expect(await probeCodecs(output)).toEqual({
      video: 'h264',
      audio: 'aac',
    })
    expect(createHash('sha256').update(await readFile(output)).digest('hex')).toHaveLength(64)
  }, 20_000)

  it('identifies the missing shot index before starting concat', async () => {
    await expect(
      concatExport(
        assemblyPlan({ width: 1920, height: 1080 }),
        {
          videoPaths: [clips[0]!, path.join(directory, 'missing.mp4'), clips[2]!],
          narrationPaths,
          musicPath: null,
        },
        subtitleAss(assemblyPlan({ width: 1920, height: 1080 })),
        path.join(directory, 'failure.mp4')
      )
    ).rejects.toThrow('分镜索引 1')
  })

  it('produces the same bytes for the same media assembly plan', async () => {
    const plan = assemblyPlan({ width: 960, height: 540 })
    const first = path.join(directory, 'deterministic-first.mp4')
    const second = path.join(directory, 'deterministic-second.mp4')
    const paths = { videoPaths: clips, narrationPaths, musicPath: null }

    await concatExport(plan, paths, subtitleAss(plan), first)
    await concatExport(plan, paths, subtitleAss(plan), second)

    expect(
      createHash('sha256').update(await readFile(first)).digest('hex')
    ).toBe(createHash('sha256').update(await readFile(second)).digest('hex'))
  }, 30_000)

  it.each([
    { width: 1280, height: 720 },
    { width: 960, height: 540 },
  ])('re-encodes to $width×$height via proportional scale', async (resolution) => {
    const output = path.join(directory, `scaled-${resolution.width}.mp4`)
    const plan = assemblyPlan(resolution)
    await concatExport(
      plan,
      { videoPaths: clips, narrationPaths, musicPath: null },
      subtitleAss(plan),
      output
    )
    expect(await probeResolution(output)).toEqual(resolution)
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

function assemblyPlan(targetResolution: {
  width: number
  height: number
}): MediaAssemblyPlan {
  return {
    fps: 30,
    totalFrames: 18,
    targetResolution,
    musicKey: null,
    shots: ['S001', 'S002', 'S003'].map((laneKey, index) => ({
      laneKey,
      video: {
        artifactId: `video-${laneKey}`,
        storageKey: `${laneKey}.mp4`,
        contentHash: 'a'.repeat(64),
      },
      durationInFrames: 6,
      narration: {
        unitId: `U00${index + 1}`,
        artifact: {
          artifactId: `audio-${laneKey}`,
          storageKey: `${laneKey}.mp3`,
          contentHash: 'b'.repeat(64),
        },
        startInUnitMs: 0,
        endInUnitMs: 200,
      },
      subtitle: {
        artifactId: `subtitle-${laneKey}`,
        storageKey: `${laneKey}.json`,
        contentHash: 'c'.repeat(64),
      },
    })),
  }
}

function subtitleAss(plan: MediaAssemblyPlan): string {
  return buildAssDocument({
    fps: plan.fps,
    targetResolution: plan.targetResolution,
    shots: plan.shots.map((shot) => ({
      laneKey: shot.laneKey,
      durationInFrames: shot.durationInFrames,
      sourceText: '字幕',
      audioDurationMs: 200,
      captions: [{ text: '字幕', startMs: 0, endMs: 200 }],
    })),
  })

}

function generateTone(file: string, frequency: number): Promise<void> {
  const executable = ffmpegPath
  if (!executable) throw new Error('ffmpeg-static unavailable')
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${frequency}:duration=0.2`,
        '-c:a',
        'libmp3lame',
        '-y',
        file,
      ],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }
    )
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`音频 fixture 生成失败：${stderr}`))
    })
  })
}

function probeCodecs(
  file: string
): Promise<{ video: string; audio: string }> {
  const executable = ffmpegPath
  if (!executable) throw new Error('ffmpeg-static unavailable')
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-hide_banner', '-i', file], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('close', () => {
      if (!stderr.includes('Video: h264') || !stderr.includes('Audio: aac')) {
        reject(new Error(`缺少预期媒体流：${stderr}`))
      } else {
        resolve({ video: 'h264', audio: 'aac' })
      }
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
      // 区分分辨率 960x540 与编解码器 tag 0x31637661：宽高限定 2-4 位数字。
      const match = /\b(\d{2,4})x(\d{2,4})\b/.exec(stderr)
      if (!match) reject(new Error(`无法读取分辨率：${stderr}`))
      else resolve({ width: Number(match[1]), height: Number(match[2]) })
    })
  })
}
