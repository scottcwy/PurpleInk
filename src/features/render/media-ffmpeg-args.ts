import path from 'node:path'
import {
  SUBTITLE_FONT_FILE,
  SUBTITLE_FONTS_DIRECTORY,
} from '@/features/audio/subtitle-style'
import type { MediaAssemblyPlan } from './media-assembly'

/**
 * 成片装配的 ffmpeg 参数构建（纯函数）。
 *
 * 从 `concat.ts` 拆出：那边负责进程编排与文件系统副作用（临时目录、写清单、
 * spawn、原子 rename），这边只把装配计划翻译成一次 ffmpeg 调用的参数序列。
 * 拆开的直接收益是参数序列可以被单测逐字锁定，而不需要真的起进程。
 */

export interface MediaAssemblyArgsInput {
  plan: MediaAssemblyPlan
  concatListPath: string
  narrationPaths: string[]
  /** null 表示本次交付不烧字幕；此时视频滤镜只做缩放。 */
  subtitlePath: string | null
  fontsDirectory: string
  musicPath: string | null
  outputPath: string
}

/**
 * 随仓库交付的字幕字体目录。
 *
 * 按 `process.cwd()` 解析（与 `src/lib/db/migrate.ts` 同一套约定；Docker 运行阶段
 * WORKDIR 是 /app，Dockerfile 需要把 assets 复制进去）。缺文件必须显式失败：libass
 * 找不到指定族名时会静默回退到宿主字体，成片字幕会变成拉丁与中文分属两个 face 的
 * 混排，而且没有任何报错——静默的视觉降级比一次明确的导出失败难查得多。
 */
export function subtitleFontsDirectory(): string {
  return path.join(process.cwd(), SUBTITLE_FONTS_DIRECTORY)
}

export function subtitleFontFile(directory: string): string {
  return path.join(directory, SUBTITLE_FONT_FILE)
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
  filters.push(`[0:v:0]${videoFilterChain(input)}[video]`)

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

/**
 * 视频滤镜链：缩放恒定，字幕按本次交付是否烧录决定。
 *
 * fontsdir 让 libass 只从随仓库交付的目录取字体，dev 与生产渲染同一份字节；
 * 不传它就退回宿主 fontconfig，拉丁与中文会落到两个不同的 face。
 */
function videoFilterChain(input: MediaAssemblyArgsInput): string {
  const scale =
    `scale=${input.plan.targetResolution.width}:${input.plan.targetResolution.height}`
    + ':flags=lanczos'
  if (!input.subtitlePath) return scale
  return [
    scale,
    `ass=filename='${escapeFilterPath(input.subtitlePath)}'`
      + `:fontsdir='${escapeFilterPath(input.fontsDirectory)}'`,
  ].join(',')
}

export function escapeFilterPath(file: string): string {
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
