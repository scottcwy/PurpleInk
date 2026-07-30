/**
 * 字幕排版实测：把生产代码产出的 ASS 真实烧录成一帧，再按像素核对结论。
 *
 * 为什么需要它：字幕的宽度预算依赖「Fontsize → 实际字面前进宽」这一比值，而该比值
 * 由 libass 最终解析到的字体的垂直度量决定，换字体就会变。任何改动 Fontsize、
 * Fontname、Margin 或单行字数闸门的任务，都必须用本脚本重新取证，不能靠推算。
 *
 * 用法：npx tsx scripts/verify/subtitle-layout-shot.ts
 *
 * 判定标准：
 * - renderedLineBands 必须为 1（单行契约）；
 * - withinSafeArea 必须为 true（墨迹落在 MarginL..1920-MarginR 之间，未被裁切）。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { buildAssDocument } from '../../src/features/audio/subtitle-ass.ts'

const WIDTH = 1920
const HEIGHT = 1080
/** 与 subtitle-ass.ts 的 Style 行保持一致；改那里必须同步改这里。 */
const MARGIN_X = 120
const INK_THRESHOLD = 128

interface LayoutMeasurement {
  cues: number
  renderedLineBands: number
  inkLeft: number
  inkRight: number
  withinSafeArea: boolean
}

const CASES: Array<{ name: string; text: string }> = [
  { name: 'cjk-30', text: '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十' },
  { name: 'cjk-gate-max', text: '甲'.repeat(32) },
  { name: 'mixed-latin-cjk', text: 'PurpleInk 把产品事实与真实演示证据做成可发布的视频' },
]

function buildAss(text: string): string {
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
      },
    ],
  })
}

function renderGrayFrame(assPath: string, outputPath: string): void {
  if (!ffmpegPath) throw new Error('ffmpeg-static 未提供当前平台二进制')
  const escaped = assPath.replaceAll('\\', '/').replace(':', String.raw`\:`)
  const result = spawnSync(
    ffmpegPath,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=black:s=${String(WIDTH)}x${String(HEIGHT)}:d=1`,
      '-vf', `ass=filename='${escaped}'`,
      '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', outputPath,
    ],
    { windowsHide: true }
  )
  if (result.status !== 0) {
    throw new Error(`ffmpeg 烧录失败：${result.stderr.toString().trim()}`)
  }
}

function measure(grayPath: string, cues: number): LayoutMeasurement {
  const bytes = readFileSync(grayPath)
  let bands = 0
  let inBand = false
  let inkLeft = WIDTH
  let inkRight = -1
  for (let y = 0; y < HEIGHT; y += 1) {
    let rowHasInk = false
    for (let x = 0; x < WIDTH; x += 1) {
      if (bytes[y * WIDTH + x]! > INK_THRESHOLD) {
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
    renderedLineBands: bands,
    inkLeft,
    inkRight,
    withinSafeArea: inkLeft >= MARGIN_X && inkRight <= WIDTH - MARGIN_X - 1,
  }
}

function main(): void {
  const work = mkdtempSync(join(tmpdir(), 'cvc-subtitle-layout-'))
  let failures = 0
  try {
    for (const item of CASES) {
      const ass = buildAss(item.text)
      const assPath = join(work, `${item.name}.ass`)
      writeFileSync(assPath, ass, 'utf8')
      const grayPath = join(work, `${item.name}.gray`)
      renderGrayFrame(assPath, grayPath)
      const cues = ass
        .split('\n')
        .filter((line) => line.startsWith('Dialogue:')).length
      const result = measure(grayPath, cues)
      const ok = result.renderedLineBands === 1 && result.withinSafeArea
      if (!ok) failures += 1
      console.log(
        `${ok ? 'PASS' : 'FAIL'} ${item.name}: cues=${String(result.cues)} `
        + `lineBands=${String(result.renderedLineBands)} `
        + `inkX=${String(result.inkLeft)}..${String(result.inkRight)} `
        + `withinSafeArea=${String(result.withinSafeArea)}`
      )
    }
    const style = buildAss('样例').split('\n').find((line) => line.startsWith('Style:'))
    console.log(`style: ${style ?? '(missing)'}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  if (failures > 0) {
    console.error(`字幕排版实测失败 ${String(failures)} 例`)
    process.exitCode = 1
  }
}

main()
