import 'server-only'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import ffmpegPath from 'ffmpeg-static'
import type { MediaAssemblyPlan } from './media-assembly'

export interface LocalMediaPaths {
  videoPaths: string[]
  narrationPaths: string[]
  musicPath: string | null
}

interface MediaAssemblyArgsInput {
  plan: MediaAssemblyPlan
  concatListPath: string
  narrationPaths: string[]
  subtitlePath: string
  musicPath: string | null
  outputPath: string
}

/** 一次 ffmpeg 调用完成分镜拼接、旁白裁剪、硬字幕和最终编码。 */
export async function concatExport(
  plan: MediaAssemblyPlan,
  paths: LocalMediaPaths,
  subtitleAss: string,
  outputPath: string
): Promise<string> {
  if (!ffmpegPath) throw new Error('ffmpeg-static 未提供当前平台二进制')
  assertPathCounts(plan, paths)
  await assertInputs(paths)
  await mkdir(path.dirname(outputPath), { recursive: true })
  const workDirectory = await mkdtemp(
    path.join(path.dirname(outputPath), '.cvc-assembly-')
  )
  const listPath = path.join(workDirectory, 'shots.ffconcat')
  const subtitlePath = path.join(workDirectory, 'subtitles.ass')
  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.tmp-${randomUUID()}.mp4`
  )
  try {
    const list = [
      'ffconcat version 1.0',
      ...paths.videoPaths.map(
        (file) => `file '${escapeConcatPath(file)}'`
      ),
    ].join('\n')
    await Promise.all([
      writeFile(listPath, `${list}\n`, 'utf8'),
      writeFile(subtitlePath, subtitleAss, 'utf8'),
    ])
    await runFfmpeg(
      buildMediaAssemblyArgs({
        plan,
        concatListPath: listPath,
        narrationPaths: paths.narrationPaths,
        subtitlePath,
        musicPath: paths.musicPath,
        outputPath: temporaryPath,
      })
    )
    await rename(temporaryPath, outputPath)
    return outputPath
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  } finally {
    await rm(workDirectory, { recursive: true, force: true })
  }
}

export function buildMediaAssemblyArgs(
  input: MediaAssemblyArgsInput
): string[] {
  const { plan } = input
  if (plan.shots.length === 0) {
    throw new Error('媒体装配至少需要一个分镜')
  }
  if (input.narrationPaths.length !== plan.shots.length) {
    throw new Error('旁白输入数量与分镜数量不一致')
  }
  const totalSeconds = plan.totalFrames / plan.fps
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    input.concatListPath,
  ]
  for (const narrationPath of input.narrationPaths) {
    args.push('-i', narrationPath)
  }
  if (input.musicPath) args.push('-stream_loop', '-1', '-i', input.musicPath)

  const filters = plan.shots.map((shot, index) => {
    const shotSeconds = shot.durationInFrames / plan.fps
    return (
      `[${index + 1}:a:0]` +
      [
        `atrim=start=${seconds(shot.narration.startInUnitMs)}:end=${seconds(shot.narration.endInUnitMs)}`,
        'asetpts=PTS-STARTPTS',
        'aresample=48000',
        'aformat=sample_rates=48000:channel_layouts=stereo',
        'apad',
        `atrim=duration=${number(shotSeconds)}`,
      ].join(',') +
      `[a${index}]`
    )
  })
  filters.push(
    `${plan.shots.map((_, index) => `[a${index}]`).join('')}concat=n=${plan.shots.length}:v=0:a=1[narration]`
  )
  const musicIndex = plan.shots.length + 1
  if (input.musicPath) {
    filters.push(
      `[${musicIndex}:a:0]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,volume=-18dB,atrim=duration=${number(totalSeconds)}[music]`,
      `[narration][music]amix=inputs=2:duration=first:normalize=0[audio]`
    )
  }
  filters.push(
    '[0:v:0]' +
      [
        `scale=${plan.targetResolution.width}:${plan.targetResolution.height}:flags=lanczos`,
        `ass=filename='${escapeFilterPath(input.subtitlePath)}'`,
      ].join(',') +
      '[video]'
  )

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[video]',
    '-map',
    input.musicPath ? '[audio]' : '[narration]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-t',
    number(totalSeconds),
    '-threads',
    '1',
    '-fflags',
    '+bitexact',
    '-flags:v',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    '-map_metadata',
    '-1',
    '-movflags',
    '+faststart',
    '-y',
    input.outputPath
  )
  return args
}

function assertPathCounts(
  plan: MediaAssemblyPlan,
  paths: LocalMediaPaths
): void {
  if (
    paths.videoPaths.length !== plan.shots.length ||
    paths.narrationPaths.length !== plan.shots.length
  ) {
    throw new Error('媒体文件数量与装配计划不一致')
  }
}

async function assertInputs(paths: LocalMediaPaths): Promise<void> {
  const files = [
    ...paths.videoPaths.map((file, index) => ({
      file,
      label: `分镜索引 ${index}`,
    })),
    ...paths.narrationPaths.map((file, index) => ({
      file,
      label: `旁白索引 ${index}`,
    })),
    ...(paths.musicPath ? [{ file: paths.musicPath, label: '配乐' }] : []),
  ]
  for (const item of files) {
    try {
      await stat(item.file)
    } catch (error) {
      throw new Error(`${item.label}的文件不存在`, { cause: error })
    }
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath!, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      reject(new Error(`ffmpeg 媒体装配启动失败：${error.message}`, { cause: error }))
    })
    child.once('close', (code) => {
      if (code === 0) resolve()
      else {
        reject(
          new Error(`ffmpeg 媒体装配失败（exit ${String(code)}）：${stderr.trim()}`)
        )
      }
    })
  })
}

function escapeConcatPath(file: string): string {
  if (/[\r\n]/.test(file)) throw new Error('concat 文件路径不能包含换行')
  return path.resolve(file).replaceAll('\\', '/').replaceAll("'", "'\\''")
}

function escapeFilterPath(file: string): string {
  return path
    .resolve(file)
    .replaceAll('\\', '/')
    .replace(':', String.raw`\:`)
    .replaceAll("'", String.raw`\'`)
    .replaceAll('[', String.raw`\[`)
    .replaceAll(']', String.raw`\]`)
}

function seconds(milliseconds: number): string {
  return number(milliseconds / 1_000)
}

function number(value: number): string {
  return Number(value.toFixed(9)).toString()
}
