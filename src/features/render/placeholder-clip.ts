import 'server-only'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'
import type { StorageAdapter } from '@/lib/storage'
import type { ArtifactRef } from './media-assembly'

/**
 * 降级导出占位片段生成器。
 *
 * 失败分镜没有 `render-mp4` 产物时，用真实 ffmpeg 生成一段等时长的纯黑视频顶替，
 * 让成片时间轴与旁白/字幕对齐不错位。黑场上不用 `drawtext`（Windows/Docker 字体
 * 链不可靠），「占位」标注改由既有 ASS 硬字幕链路承担（见 export-service）。
 *
 * 占位片段是**导出的内部输入**，不是业务 artifact：它以确定性 storage key 落盘
 * （bitexact 黑场对同一 (分辨率, fps, 帧数) 逐字节一致），供 concat 消费，其真实
 * 字节最终汇入 final-mp4 的哈希。占位清单由 `final-mp4-degraded-manifest` 产物如实记录。
 */

/** 占位视频参数；分辨率/fps 与真实 render-mp4（见 encode.ts）对齐以便 concat 拼接。 */
export interface PlaceholderVideoParams {
  width: number
  height: number
  fps: number
  durationInFrames: number
}

/** 运行 ffmpeg 的注入点；生产用 ffmpeg-static，测试可替身。 */
export type FfmpegRunner = (args: string[]) => Promise<void>

export interface PlaceholderClipDependencies {
  storage: StorageAdapter
  runFfmpeg?: FfmpegRunner
}

/** 纯函数：黑场视频的 ffmpeg 参数（可单测），编码参数镜像 encode.ts。 */
export function buildBlackClipArgs(
  params: PlaceholderVideoParams & { outputPath: string }
): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${params.width}x${params.height}:r=${params.fps}`,
    '-frames:v',
    String(params.durationInFrames),
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
    params.outputPath,
  ]
}

/** 纯函数：静音旁白的 ffmpeg 参数（可单测）；48kHz 立体声与 concat 重采样目标一致。 */
export function buildSilentNarrationArgs(params: {
  durationMs: number
  outputPath: string
}): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=48000:cl=stereo',
    '-t',
    seconds(params.durationMs),
    '-c:a',
    'pcm_s16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-map_metadata',
    '-1',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    '-y',
    params.outputPath,
  ]
}

/** 占位视频的确定性存储键；同参数逐字节一致，故可据 key 幂等复用。 */
export function placeholderVideoKey(
  projectId: string,
  laneKey: string,
  params: PlaceholderVideoParams
): string {
  return (
    `exports/${projectId}/placeholders/` +
    `${laneKey}-${params.width}x${params.height}-${params.durationInFrames}f.mp4`
  )
}

/** 占位旁白的确定性存储键。 */
export function placeholderNarrationKey(
  projectId: string,
  laneKey: string,
  durationMs: number
): string {
  return `exports/${projectId}/placeholders/${laneKey}-narration-${Math.round(durationMs)}ms.wav`
}

/**
 * 生成（或幂等复用）一段占位黑场视频，返回可直接进入装配计划的引用。
 * `artifactId` 是合成标识（`placeholder-video:{lane}`），仅作占位区分，不落 artifacts 表；
 * 装配下游只消费 `storageKey`（concat）与 `contentHash`（导出诚实性），不依赖该 id。
 */
export async function generatePlaceholderVideo(
  input: {
    projectId: string
    laneKey: string
    params: PlaceholderVideoParams
  },
  dependencies: PlaceholderClipDependencies
): Promise<ArtifactRef> {
  const key = placeholderVideoKey(input.projectId, input.laneKey, input.params)
  const bytes = await resolveOrProduce(dependencies, key, (outputPath) =>
    buildBlackClipArgs({ ...input.params, outputPath })
  )
  return {
    artifactId: `placeholder-video:${input.laneKey}`,
    storageKey: key,
    contentHash: digest(bytes),
  }
}

/** 生成（或幂等复用）一段等时长静音旁白，返回装配计划引用。 */
export async function generatePlaceholderNarration(
  input: { projectId: string; laneKey: string; durationMs: number },
  dependencies: PlaceholderClipDependencies
): Promise<ArtifactRef> {
  const key = placeholderNarrationKey(
    input.projectId,
    input.laneKey,
    input.durationMs
  )
  const bytes = await resolveOrProduce(dependencies, key, (outputPath) =>
    buildSilentNarrationArgs({ durationMs: input.durationMs, outputPath })
  )
  return {
    artifactId: `placeholder-narration:${input.laneKey}`,
    storageKey: key,
    contentHash: digest(bytes),
  }
}

/** 已存在则读回复用（bitexact 决定同参数同字节）；否则 ffmpeg 生成后落盘。 */
async function resolveOrProduce(
  dependencies: PlaceholderClipDependencies,
  key: string,
  toArgs: (outputPath: string) => string[]
): Promise<Buffer> {
  const { storage } = dependencies
  if (await storage.exists(key)) return storage.get(key)
  const run = dependencies.runFfmpeg ?? defaultRunFfmpeg
  const workDirectory = await storage.tempDir('cvc-placeholder-')
  try {
    const outputPath = path.join(workDirectory, path.basename(key))
    await run(toArgs(outputPath))
    // 生产者关闭后再读字节算哈希（工作流失败模式手册模式 G）。
    const bytes = await storage.readLocalFile(outputPath)
    await storage.put(key, bytes)
    return bytes
  } finally {
    await storage.removeTempDir(workDirectory)
  }
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function seconds(milliseconds: number): string {
  return Number((milliseconds / 1_000).toFixed(9)).toString()
}

function defaultRunFfmpeg(args: string[]): Promise<void> {
  if (!ffmpegPath) throw new Error('ffmpeg-static 未提供当前平台二进制')
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
      reject(new Error(`ffmpeg 占位片段生成启动失败：${error.message}`, { cause: error }))
    })
    child.once('close', (code) => {
      if (code === 0) resolve()
      else {
        reject(
          new Error(`ffmpeg 占位片段生成失败（exit ${String(code)}）：${stderr.trim()}`)
        )
      }
    })
  })
}
