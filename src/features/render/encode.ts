import 'server-only'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { mkdir, rename, rm } from 'node:fs/promises'
import ffmpegPath from 'ffmpeg-static'
import type { FrameSequence } from './frame-sequence'

/** 从磁盘帧 pattern 流式编码确定性 mp4，并以原子 rename 提交。 */
export async function encodeToMp4(
  sequence: FrameSequence,
  fps: number,
  outputPath: string
): Promise<string> {
  if (!ffmpegPath) throw new Error('ffmpeg-static 未提供当前平台二进制')
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`fps 必须大于 0：${fps}`)
  await mkdir(path.dirname(outputPath), { recursive: true })
  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.tmp-${randomUUID()}.mp4`
  )
  try {
    await runFfmpeg(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-framerate',
      String(fps),
      '-start_number',
      '0',
      '-i',
      sequence.pattern,
      '-frames:v',
      String(sequence.totalFrames),
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-threads',
      '1',
      '-map_metadata',
      '-1',
      '-fflags',
      '+bitexact',
      '-flags:v',
      '+bitexact',
      '-movflags',
      '+faststart',
      '-y',
      temporaryPath,
    ])
    await rename(temporaryPath, outputPath)
    return outputPath
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

function runFfmpeg(executable: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      reject(new Error(`ffmpeg 启动失败：${error.message}`, { cause: error }))
    })
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg 编码失败（exit ${String(code)}）：${stderr.trim()}`))
    })
  })
}
