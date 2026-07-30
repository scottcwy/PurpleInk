import 'server-only'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import ffmpegPath from 'ffmpeg-static'
import {
  SUBTITLE_FONT_FILE,
  SUBTITLE_FONTS_DIRECTORY,
} from '@/features/audio/subtitle-style'
import {
  subtitleFontFile,
  subtitleFontsDirectory,
} from './media-ffmpeg-args'
import type { MediaAssemblyPlan } from './media-assembly'
import {
  prepareProceduralSfx,
  runMediaAssemblyWithSfxFallback,
  type ProceduralSfxMixResult,
} from './procedural-sfx-mix'

export { subtitleFontsDirectory }

export interface LocalMediaPaths {
  videoPaths: string[]
  narrationPaths: string[]
  musicPath: string | null
}

export interface ConcatExportResult {
  outputPath: string
  soundEffects: ProceduralSfxMixResult
}

async function assertSubtitleFont(directory: string): Promise<void> {
  try {
    await stat(subtitleFontFile(directory))
  } catch (error) {
    throw new Error(
      `字幕字体缺失：${SUBTITLE_FONTS_DIRECTORY}/${SUBTITLE_FONT_FILE}`,
      { cause: error }
    )
  }
}

/**
 * 一次 ffmpeg 调用完成分镜拼接、旁白裁剪、硬字幕和最终编码。
 *
 * `subtitleAss` 为 null 表示本次交付不烧字幕：既不写 .ass，也不校验字体，
 * 视频滤镜只做缩放。字体缺失的显式失败只约束真正要烧字幕的那条路径。
 */
export async function concatExport(
  plan: MediaAssemblyPlan,
  paths: LocalMediaPaths,
  subtitleAss: string | null,
  outputPath: string
): Promise<ConcatExportResult> {
  if (!ffmpegPath) throw new Error('ffmpeg-static 未提供当前平台二进制')
  assertPathCounts(plan, paths)
  await assertInputs(paths)
  const fontsDirectory = subtitleFontsDirectory()
  if (subtitleAss !== null) await assertSubtitleFont(fontsDirectory)
  await mkdir(path.dirname(outputPath), { recursive: true })
  const workDirectory = await mkdtemp(
    path.join(path.dirname(outputPath), '.cvc-assembly-')
  )
  const listPath = path.join(workDirectory, 'shots.ffconcat')
  const subtitlePath =
    subtitleAss === null ? null : path.join(workDirectory, 'subtitles.ass')
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
      ...(subtitlePath === null
        ? []
        : [writeFile(subtitlePath, subtitleAss ?? '', 'utf8')]),
    ])
    const preparedSoundEffects = await prepareProceduralSfx(plan, workDirectory)
    const soundEffects = await runMediaAssemblyWithSfxFallback({
      baseInput: {
        plan,
        concatListPath: listPath,
        narrationPaths: paths.narrationPaths,
        subtitlePath,
        fontsDirectory,
        musicPath: paths.musicPath,
        outputPath: temporaryPath,
      },
      prepared: preparedSoundEffects,
      runner: runFfmpeg,
    })
    await rename(temporaryPath, outputPath)
    return { outputPath, soundEffects }
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  } finally {
    await rm(workDirectory, { recursive: true, force: true })
  }
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
