import {
  SUBTITLE_MAX_LINE_GRAPHEMES,
  SUBTITLE_PLAY_RES_X,
  SUBTITLE_PLAY_RES_Y,
  SUBTITLE_STYLE_FORMAT,
  subtitleStyleLines,
  subtitleStyleName,
  type SubtitleContrast,
} from './subtitle-style'
import type { Caption } from './types'

export interface ReadableSubtitleCue {
  startMs: number
  endMs: number
  text: string
  lines: string[]
}

interface SubtitleTrackInput {
  sourceText: string
  audioDurationMs: number
  captions: Caption[]
}

interface AssShot extends SubtitleTrackInput {
  laneKey: string
  durationInFrames: number
  /** 降级占位镜头：直接给定 cue（如「S007 · 占位」），跳过 ASR↔原稿校验。 */
  precomputedCues?: ReadableSubtitleCue[]
  /**
   * 本镜字幕带的背景明暗，决定引用哪一套 Style。省略按 `on-dark` 处理——白字黑描边
   * 在深色底上是安全默认，探针失败或占位黑场都应落到这一侧。
   */
  contrast?: SubtitleContrast
}

interface AssDocumentInput {
  fps: 24 | 30 | 60
  targetResolution: { width: number; height: number }
  shots: AssShot[]
}

/**
 * 单行字数闸门。字幕只排一行；上限由可用宽度推导，推导过程与取证方式见
 * `subtitle-style.ts` 的 `SUBTITLE_MAX_LINE_GRAPHEMES`。
 *
 * 一条 cue 就是一行，所以两个上限相等——不要再把 cue 上限写成行上限的倍数，那等于
 * 用常量结构把「允许换行」写死。
 */
const MAX_LINE_GRAPHEMES = SUBTITLE_MAX_LINE_GRAPHEMES
const MAX_CUE_GRAPHEMES = MAX_LINE_GRAPHEMES
const MAX_CUE_MS = 4_000
const TARGET_MIN_CUE_MS = 1_200

export function normalizeSubtitleTrack(
  input: SubtitleTrackInput
): ReadableSubtitleCue[] {
  const source = graphemes(input.sourceText)
  if (source.length === 0) throw new Error('字幕原稿为空')
  const timed = repairAndValidateCaptions(input.captions, input.audioDurationMs)
  const asrLength = timed.reduce(
    (total, caption) => total + normalizedGraphemeCount(caption.text),
    0
  )
  const sourceLength = normalizedGraphemeCount(input.sourceText)
  if (
    sourceLength === 0 ||
    Math.abs(sourceLength - asrLength) / sourceLength > 0.1
  ) {
    throw new Error('ASR 与原稿文本漂移超过 10%')
  }

  const mapped = mapSourceToTimeline(source, timed)
  return aggregateReadableCues(mapped)
}

/**
 * 单段 ASR 已提供可信的整段时间范围、但英文品牌词等导致识别文本长度漂移时，
 * 保留真实时间范围并改用可信原稿。多段或非法时间轴仍由严格门禁拒绝。
 */
export function normalizeSubtitleTrackWithWholeClipFallback(
  input: SubtitleTrackInput
): ReadableSubtitleCue[] {
  try {
    return normalizeSubtitleTrack(input)
  } catch (error) {
    const only = input.captions.length === 1 ? input.captions[0] : undefined
    if (
      !only
      || only.startMs !== 0
      || only.endMs <= 0
      || only.endMs > input.audioDurationMs
    ) {
      throw error
    }
    return normalizeSubtitleTrack({
      ...input,
      captions: [{ ...only, text: input.sourceText }],
    })
  }
}

export function buildAssDocument(input: AssDocumentInput): string {
  void input.targetResolution
  const dialogue: string[] = []
  let priorFrames = 0
  for (const shot of input.shots) {
    const offsetMs = (priorFrames * 1_000) / input.fps
    const cues = shot.precomputedCues ?? normalizeSubtitleTrack(shot)
    const styleName = subtitleStyleName(shot.contrast ?? 'on-dark')
    for (const cue of cues) {
      dialogue.push(
        [
          'Dialogue: 0',
          assTime(offsetMs + cue.startMs),
          assTime(offsetMs + cue.endMs),
          styleName,
          '',
          '0',
          '0',
          '0',
          '',
          cue.lines.map(escapeAssText).join(String.raw`\N`),
        ].join(',')
      )
    }
    priorFrames += shot.durationInFrames
  }
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    // WrapStyle 2 = 只在显式 \N 处换行。字数闸门已保证单行不溢出，禁止 libass
    // 自行折行，避免拉丁词较多的 cue 在空格处被拆成两行。
    'WrapStyle: 2',
    `PlayResX: ${String(SUBTITLE_PLAY_RES_X)}`,
    `PlayResY: ${String(SUBTITLE_PLAY_RES_Y)}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    SUBTITLE_STYLE_FORMAT,
    ...subtitleStyleLines(),
    '',
    '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
    ...dialogue,
    '',
  ].join('\n')
}

function repairAndValidateCaptions(
  captions: Caption[],
  audioDurationMs: number
): Caption[] {
  const repaired: Caption[] = []
  let pendingPrefix = ''
  let previousEnd = 0
  for (const caption of captions) {
    if (
      !Number.isFinite(caption.startMs) ||
      !Number.isFinite(caption.endMs) ||
      caption.startMs < 0 ||
      caption.endMs < caption.startMs ||
      caption.endMs > audioDurationMs ||
      caption.startMs < previousEnd
    ) {
      throw new Error('字幕时间轴无效或发生倒退')
    }
    if (caption.startMs === caption.endMs) {
      if (repaired.length > 0) {
        repaired[repaired.length - 1]!.text += caption.text
      } else {
        pendingPrefix += caption.text
      }
      continue
    }
    repaired.push({ ...caption, text: pendingPrefix + caption.text })
    pendingPrefix = ''
    previousEnd = caption.endMs
  }
  if (pendingPrefix && repaired.length > 0) {
    repaired[repaired.length - 1]!.text += pendingPrefix
  }
  if (repaired.length === 0) throw new Error('字幕仅包含零时长 token')
  return repaired
}

function mapSourceToTimeline(source: string[], captions: Caption[]): Caption[] {
  const weights = captions.map((caption) =>
    Math.max(1, normalizedGraphemeCount(caption.text))
  )
  const weightTotal = weights.reduce((total, weight) => total + weight, 0)
  let sourceStart = 0
  let weightEnd = 0
  const mapped: Caption[] = []
  captions.forEach((caption, index) => {
    weightEnd += weights[index]!
    const sourceEnd =
      index === captions.length - 1
        ? source.length
        : Math.round((weightEnd / weightTotal) * source.length)
    const text = source.slice(sourceStart, sourceEnd)
    mapped.push(
      ...splitLongCaption({
        startMs: caption.startMs,
        endMs: caption.endMs,
        text: text.join(''),
      })
    )
    sourceStart = sourceEnd
  })
  return mapped
}

function splitLongCaption(caption: Caption): Caption[] {
  const text = graphemes(caption.text)
  if (text.length <= MAX_CUE_GRAPHEMES) return [caption]
  const chunks: Caption[] = []
  const count = Math.ceil(text.length / MAX_CUE_GRAPHEMES)
  for (let index = 0; index < count; index += 1) {
    const start = Math.round(
      caption.startMs + ((caption.endMs - caption.startMs) * index) / count
    )
    const end = Math.round(
      caption.startMs + ((caption.endMs - caption.startMs) * (index + 1)) / count
    )
    chunks.push({
      startMs: start,
      endMs: end,
      text: text
        .slice(index * MAX_CUE_GRAPHEMES, (index + 1) * MAX_CUE_GRAPHEMES)
        .join(''),
    })
  }
  return chunks
}

function aggregateReadableCues(captions: Caption[]): ReadableSubtitleCue[] {
  const cues: Caption[] = []
  for (const caption of captions) {
    const current = cues[cues.length - 1]
    const combinedLength = current
      ? graphemes(current.text + caption.text).length
      : Number.POSITIVE_INFINITY
    const combinedDuration = current ? caption.endMs - current.startMs : 0
    if (
      current &&
      combinedLength <= MAX_CUE_GRAPHEMES &&
      combinedDuration <= MAX_CUE_MS &&
      (current.endMs - current.startMs < TARGET_MIN_CUE_MS ||
        !endsWithBoundary(current.text))
    ) {
      current.text += caption.text
      current.endMs = caption.endMs
    } else {
      cues.push({ ...caption })
    }
  }
  return cues.map((cue) => ({
    ...cue,
    lines: wrapCue(cue.text),
  }))
}

/**
 * 一条 cue 一行。上游 splitLongCaption 与 aggregateReadableCues 已把每条 cue 压到
 * MAX_CUE_GRAPHEMES 以内，因此这里只做防御：真的超长时截断并抛错，而不是像早先的
 * 实现那样静默丢弃 slice 之外的字（那会让成片少字且无人察觉）。
 */
function wrapCue(text: string): string[] {
  const items = graphemes(text)
  if (items.length > MAX_CUE_GRAPHEMES) {
    throw new Error(
      `字幕单行超出安全宽度：${String(items.length)} 字素 > ${String(MAX_CUE_GRAPHEMES)}`
    )
  }
  return [text]
}

function normalizedGraphemeCount(text: string): number {
  return graphemes(
    text.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, '')
  ).length
}

function graphemes(text: string): string[] {
  const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' })
  return [...segmenter.segment(text)].map((item) => item.segment)
}

function endsWithBoundary(text: string): boolean {
  return /[。！？!?；;，,：:]$/u.test(text)
}

function escapeAssText(text: string): string {
  return text
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('{', String.raw`\{`)
    .replaceAll('}', String.raw`\}`)
    .replaceAll('\r', '')
    .replaceAll('\n', String.raw`\N`)
}

function assTime(milliseconds: number): string {
  const centiseconds = Math.max(0, Math.round(milliseconds / 10))
  const hours = Math.floor(centiseconds / 360_000)
  const minutes = Math.floor((centiseconds % 360_000) / 6_000)
  const seconds = Math.floor((centiseconds % 6_000) / 100)
  const fraction = centiseconds % 100
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`
}
