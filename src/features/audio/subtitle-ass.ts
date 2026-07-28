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
}

interface AssDocumentInput {
  fps: 24 | 30 | 60
  targetResolution: { width: number; height: number }
  shots: AssShot[]
}

const MAX_LINE_GRAPHEMES = 18
const MAX_CUE_GRAPHEMES = MAX_LINE_GRAPHEMES * 2
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

export function buildAssDocument(input: AssDocumentInput): string {
  void input.targetResolution
  const dialogue: string[] = []
  let priorFrames = 0
  for (const shot of input.shots) {
    const offsetMs = (priorFrames * 1_000) / input.fps
    const cues = shot.precomputedCues ?? normalizeSubtitleTrack(shot)
    for (const cue of cues) {
      dialogue.push(
        [
          'Dialogue: 0',
          assTime(offsetMs + cue.startMs),
          assTime(offsetMs + cue.endMs),
          'Default',
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
    'PlayResX: 1920',
    'PlayResY: 1080',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    'Style: Default,sans-serif,52,&H00FFFFFF,&H00FFFFFF,&H80000000,&H80000000,0,0,0,0,100,100,0,0,3,10,0,2,120,120,72,1',
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

function wrapCue(text: string): string[] {
  const items = graphemes(text)
  if (items.length <= MAX_LINE_GRAPHEMES) return [text]
  return [
    items.slice(0, MAX_LINE_GRAPHEMES).join(''),
    items.slice(MAX_LINE_GRAPHEMES, MAX_CUE_GRAPHEMES).join(''),
  ]
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
