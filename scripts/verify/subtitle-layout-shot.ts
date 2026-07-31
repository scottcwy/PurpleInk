/**
 * 字幕排版实测：把生产代码产出的 ASS 真实烧录成一帧，再按像素核对结论。
 *
 * 为什么需要它：字幕的宽度预算依赖「Fontsize → 实际字面前进宽」这一比值，而该比值
 * 由 libass 最终解析到的字体的垂直度量决定，换字体就会变。任何改动 Fontsize、
 * Fontname、Margin、单行字数闸门或明暗样式的任务，都必须用本脚本重新取证。
 *
 * 用法：npx tsx scripts/verify/subtitle-layout-shot.ts
 *
 * 测量方法：同一背景分别渲染「无字幕」与「有字幕」两帧再做差。变化的像素就是字幕
 * 的墨迹，因此对白字压深底与黑字压浅底两套样式都成立，不需要假设墨色比背景更亮。
 *
 * 判定标准：
 * - lineBands 必须为 1（单行契约）；
 * - withinSafeArea 必须为 true（墨迹落在 MarginL..PlayResX-MarginR 之间，未被裁切）。
 *
 * 本脚本只回答几何问题。明暗两套样式该不该翻转是对比度问题，用 WCAG 对比度解析计算
 * 更准（见 features/audio/subtitle-style.ts 的注释），不要在这里编造像素指标：墨迹
 * 差值在两套样式下统计的是不同部位（一边只剩描边、一边只剩字身），不可跨样式比较。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { buildAssDocument } from '../../src/features/audio/subtitle-ass'
import {
  SUBTITLE_MARGIN_X,
  SUBTITLE_MAX_LINE_GRAPHEMES,
  SUBTITLE_PLAY_RES_X,
  SUBTITLE_PLAY_RES_Y,
  subtitleStyleLines,
  type SubtitleContrast,
} from '../../src/features/audio/subtitle-style'

const WIDTH = SUBTITLE_PLAY_RES_X
const HEIGHT = SUBTITLE_PLAY_RES_Y
/** 差值超过该阈值视为字幕墨迹，滤掉编码噪声。 */
const DELTA_THRESHOLD = 24

const DARK_BG = '0x101014'
const LIGHT_BG = '0xf4f4f6'

interface Measurement {
  cues: number
  lineBands: number
  inkLeft: number
  inkRight: number
  withinSafeArea: boolean
}

interface Case {
  name: string
  text: string
  contrast: SubtitleContrast
  background: string
  /** 期望的 cue 条数；省略表示 1 条。 */
  expectedCues?: number
}

/** 恰好压在闸门上限：必须仍是一条 cue、一行，且不越出安全区。 */
const GATE_MAX_CJK = '甲'.repeat(SUBTITLE_MAX_LINE_GRAPHEMES)
/** 超出闸门一倍：必须切成多条 cue，每条各自单行，而不是折行或丢字。 */
const OVER_GATE_CJK = '乙'.repeat(SUBTITLE_MAX_LINE_GRAPHEMES * 2)
const MIXED = 'PurpleInk 把产品事实与真实演示证据做成可发布的视频'

const CASES: Case[] = [
  { name: 'dark-bg/on-dark/gate-max', text: GATE_MAX_CJK, contrast: 'on-dark', background: DARK_BG },
  { name: 'dark-bg/on-dark/over-gate', text: OVER_GATE_CJK, contrast: 'on-dark', background: DARK_BG, expectedCues: 2 },
  { name: 'dark-bg/on-dark/mixed', text: MIXED, contrast: 'on-dark', background: DARK_BG },
  { name: 'light-bg/on-light/gate-max', text: GATE_MAX_CJK, contrast: 'on-light', background: LIGHT_BG },
  { name: 'light-bg/on-light/over-gate', text: OVER_GATE_CJK, contrast: 'on-light', background: LIGHT_BG, expectedCues: 2 },
  { name: 'light-bg/on-light/mixed', text: MIXED, contrast: 'on-light', background: LIGHT_BG },
]

function buildAss(text: string, contrast: SubtitleContrast): string {
  return buildAssDocument({
    fps: 30,
    targetResolution: { width: WIDTH, height: HEIGHT },
    shots: [
      {
        laneKey: 'S001',
        durationInFrames: 120,
        sourceText: text,
        audioDurationMs: 4_000,
        captions: [{ text, startMs: 0, endMs: 4_000 }],
        contrast,
      },
    ],
  })
}

function renderGray(
  background: string,
  assPath: string | null,
  outputPath: string
): void {
  if (!ffmpegPath) throw new Error('ffmpeg-static 未提供当前平台二进制')
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi',
    '-i', `color=c=${background}:s=${String(WIDTH)}x${String(HEIGHT)}:d=1`,
  ]
  if (assPath) {
    const escaped = assPath.replaceAll('\\', '/').replace(':', String.raw`\:`)
    args.push('-vf', `ass=filename='${escaped}'`)
  }
  args.push('-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', outputPath)
  const result = spawnSync(ffmpegPath, args, { windowsHide: true })
  if (result.status !== 0) {
    throw new Error(`ffmpeg 烧录失败：${result.stderr.toString().trim()}`)
  }
}

function measure(basePath: string, withAssPath: string, cues: number): Measurement {
  const base = readFileSync(basePath)
  const drawn = readFileSync(withAssPath)
  let bands = 0
  let inBand = false
  let inkLeft = WIDTH
  let inkRight = -1
  for (let y = 0; y < HEIGHT; y += 1) {
    let rowHasInk = false
    for (let x = 0; x < WIDTH; x += 1) {
      const index = y * WIDTH + x
      if (Math.abs(drawn[index]! - base[index]!) > DELTA_THRESHOLD) {
        rowHasInk = true
        if (x < inkLeft) inkLeft = x
        if (x > inkRight) inkRight = x
      }
    }
    if (rowHasInk && !inBand) bands += 1
    inBand = rowHasInk
  }
  return {
    cues,
    lineBands: bands,
    inkLeft,
    inkRight,
    withinSafeArea:
      inkLeft >= SUBTITLE_MARGIN_X && inkRight <= WIDTH - SUBTITLE_MARGIN_X - 1,
  }
}

function runCase(work: string, item: Case, index: number): boolean {
  const ass = buildAss(item.text, item.contrast)
  const assPath = join(work, `case-${String(index)}.ass`)
  writeFileSync(assPath, ass, 'utf8')
  const basePath = join(work, `case-${String(index)}-base.gray`)
  const drawnPath = join(work, `case-${String(index)}-drawn.gray`)
  renderGray(item.background, null, basePath)
  renderGray(item.background, assPath, drawnPath)
  const cues = ass.split('\n').filter((line) => line.startsWith('Dialogue:')).length
  const result = measure(basePath, drawnPath, cues)
  // 同一帧只会画出当前时间点生效的那一条 cue，所以无论切成几条，lineBands 都必须是 1。
  const ok =
    result.lineBands === 1
    && result.withinSafeArea
    && result.cues === (item.expectedCues ?? 1)
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${item.name}: cues=${String(result.cues)} `
    + `lineBands=${String(result.lineBands)} `
    + `inkX=${String(result.inkLeft)}..${String(result.inkRight)} `
    + `withinSafeArea=${String(result.withinSafeArea)}`
  )
  return ok
}

function main(): void {
  const work = mkdtempSync(join(tmpdir(), 'cvc-subtitle-layout-'))
  let failures = 0
  try {
    for (const [index, item] of CASES.entries()) {
      if (!runCase(work, item, index)) failures += 1
    }
    for (const style of subtitleStyleLines()) console.log(`style: ${style}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  if (failures > 0) {
    console.error(`字幕排版实测失败 ${String(failures)} 例`)
    process.exitCode = 1
  }
}

main()
