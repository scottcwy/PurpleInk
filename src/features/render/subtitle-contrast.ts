import 'server-only'
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import ffmpegPath from 'ffmpeg-static'
import {
  SUBTITLE_BAND_FRACTIONS,
  type SubtitleContrast,
} from '@/features/audio/subtitle-style'

/**
 * 判定单个分镜「字幕带背后是浅色还是深色」，用来在两套 ASS Style 之间选一套。
 *
 * 真值只能来自实际渲染出来的画面：Director 的分镜合同里没有任何 palette / theme /
 * background 字段（grep 过 `features/director/schemas/**`，零命中），而复用 QA 抽帧
 * 会把字幕排版绑到 QA 是否跑过。所以这里直接量分镜自己的 mp4。
 *
 * 实测口径（见 commit 说明）：
 * - 只解码关键帧（`-skip_frame nokey`）取中位数，与全量解码的结果误差 ≤1，耗时约 1/4
 *   （真实分镜 mp4 上 82-106ms vs 395-424ms）；
 * - 纯暗底 YAVG 约 30，纯亮底约 226，中灰约 121；
 * - 阈值取 140：明显高于中灰，把模糊地带偏向更安全的深色样式。
 *
 * 任何一步失败（缺文件、无 ffmpeg、无采样、解析不出数值）都返回 `on-dark`：白字黑
 * 描边是深色底上的安全默认，降级导出的黑场占位也应落在这一侧。
 */

/** YAVG 达到该值判为浅色底。yuv420p 限制范围下黑约 16、白约 235。 */
const LIGHT_BACKGROUND_YAVG = 140
const PROBE_TIMEOUT_MS = 15_000

export type SubtitleContrastProbe = (
  videoPath: string
) => Promise<SubtitleContrast>

export async function probeSubtitleContrast(
  videoPath: string
): Promise<SubtitleContrast> {
  const median = await bandLumaMedian(videoPath)
  if (median === null) return 'on-dark'
  return median >= LIGHT_BACKGROUND_YAVG ? 'on-light' : 'on-dark'
}

async function bandLumaMedian(videoPath: string): Promise<number | null> {
  if (!ffmpegPath) return null
  try {
    await stat(videoPath)
  } catch {
    return null
  }
  const samples = await readYavgSamples(videoPath)
  if (samples.length === 0) return null
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? null
}

function bandCropFilter(): string {
  const { x, y, width, height } = SUBTITLE_BAND_FRACTIONS
  return [
    `crop=w=iw*${width.toFixed(6)}`,
    `h=ih*${height.toFixed(6)}`,
    `x=iw*${x.toFixed(6)}`,
    `y=ih*${y.toFixed(6)}`,
  ].join(':')
}

function readYavgSamples(videoPath: string): Promise<number[]> {
  return new Promise((resolve) => {
    const child = spawn(
      ffmpegPath!,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        // 只解码关键帧：一个分镜取到 1-2 个样本足够做二值判定，且比全量解码快数倍。
        '-skip_frame',
        'nokey',
        '-i',
        videoPath,
        '-vf',
        `${bandCropFilter()},signalstats,metadata=print:file=-`,
        '-an',
        '-f',
        'null',
        '-',
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    const samples: number[] = []
    let buffered = ''
    const timer = setTimeout(() => {
      child.kill()
    }, PROBE_TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffered += chunk
    })
    const finish = (): void => {
      clearTimeout(timer)
      for (const match of buffered.matchAll(
        /lavfi\.signalstats\.YAVG=([0-9.]+)/g
      )) {
        const value = Number(match[1])
        if (Number.isFinite(value)) samples.push(value)
      }
      resolve(samples)
    }
    child.once('error', () => {
      clearTimeout(timer)
      resolve([])
    })
    child.once('close', finish)
  })
}
