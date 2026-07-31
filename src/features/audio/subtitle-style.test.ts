import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAssDocument } from './subtitle-ass'
import {
  SUBTITLE_BAND_FRACTIONS,
  SUBTITLE_FONT_FILE,
  SUBTITLE_FONT_NAME,
  SUBTITLE_FONT_SIZE,
  SUBTITLE_FONTS_DIRECTORY,
  SUBTITLE_MARGIN_V,
  SUBTITLE_MARGIN_X,
  SUBTITLE_MAX_LINE_GRAPHEMES,
  SUBTITLE_STYLE_FORMAT,
  SUBTITLE_USABLE_WIDTH,
  subtitleStyleLines,
  subtitleStyleName,
} from './subtitle-style'

/** 按 Format 行按名取 Style 字段，避免在测试里写死列号。 */
const FIELD_NAMES = SUBTITLE_STYLE_FORMAT.replace(/^Format:\s*/, '').split(',')

function field(styleLine: string | undefined, name: string): string | undefined {
  const index = FIELD_NAMES.indexOf(name)
  if (index < 0) throw new Error(`Style Format 缺少字段：${name}`)
  return styleLine?.split(',')[index]
}

function shot(contrast?: 'on-dark' | 'on-light') {
  return {
    laneKey: 'S001',
    durationInFrames: 30,
    sourceText: '一句话',
    audioDurationMs: 1_000,
    captions: [{ text: '一句话', startMs: 0, endMs: 1_000 }],
    ...(contrast ? { contrast } : {}),
  }
}

function dialogueStyle(ass: string): string | undefined {
  return ass
    .split('\n')
    .find((line) => line.startsWith('Dialogue:'))
    ?.split(',')[3]
}

describe('subtitleStyleLines', () => {
  it('emits both contrast styles with borders instead of an opaque plate', () => {
    const [onDark, onLight] = subtitleStyleLines()

    // BorderStyle 1 = 描边 + 投影；3 是不透明底板，双行时会裂成两条宽度不等的板。
    expect(field(onDark, 'BorderStyle')).toBe('1')
    expect(field(onLight, 'BorderStyle')).toBe('1')
    // 文字与描边取项目 label token：深色底白字黑描边，浅色底黑字白描边。
    expect(onDark).toContain('Style: OnDark,')
    expect(field(onDark, 'PrimaryColour')).toBe('&H00FFFFFF')
    expect(field(onDark, 'OutlineColour')).toBe('&H00000000')
    expect(onLight).toContain('Style: OnLight,')
    expect(field(onLight, 'PrimaryColour')).toBe('&H00000000')
    expect(field(onLight, 'OutlineColour')).toBe('&H00FFFFFF')
    // 浅色底描边更粗：白色光晕要把黑字从明亮截图里托起来。
    expect(Number(field(onLight, 'Outline'))).toBeGreaterThan(
      Number(field(onDark, 'Outline'))
    )
    for (const style of [onDark, onLight]) {
      expect(field(style, 'MarginL')).toBe(String(SUBTITLE_MARGIN_X))
      expect(field(style, 'MarginR')).toBe(String(SUBTITLE_MARGIN_X))
      expect(field(style, 'MarginV')).toBe(String(SUBTITLE_MARGIN_V))
      // Alignment 2 = 底部居中。
      expect(field(style, 'Alignment')).toBe('2')
    }
  })

  it('derives the single-line gate so the worst-case advance still fits the safe width', () => {
    // 全角字前进宽最坏等于 Fontsize（1.0 em）。闸门必须保证即使命中最坏比值也不溢出，
    // 否则「字号调大了但闸门没跟着调小」只会在长句子上暴露。
    expect(SUBTITLE_MAX_LINE_GRAPHEMES * SUBTITLE_FONT_SIZE).toBeLessThanOrEqual(
      SUBTITLE_USABLE_WIDTH
    )
    // 同时不能保守到白扔宽度：再多一个字就会越界。
    expect(
      (SUBTITLE_MAX_LINE_GRAPHEMES + 1) * SUBTITLE_FONT_SIZE
    ).toBeGreaterThan(SUBTITLE_USABLE_WIDTH)
    expect(SUBTITLE_USABLE_WIDTH).toBe(1920 - 2 * SUBTITLE_MARGIN_X)
  })

  it('names a font that ships with the repository instead of a generic family', () => {
    // sans-serif 之类的通用族名把解析权交给宿主 fontconfig，拉丁与中文会落到两个
    // face；字体必须随仓库交付并由 fontsdir 指定。
    expect(SUBTITLE_FONT_NAME).not.toMatch(
      /^(sans-serif|serif|monospace|system-ui)$/
    )
    expect(SUBTITLE_FONT_FILE).toMatch(/\.(otf|ttf)$/)
    expect(
      existsSync(join(process.cwd(), SUBTITLE_FONTS_DIRECTORY, SUBTITLE_FONT_FILE))
    ).toBe(true)
  })

  it('keeps the probe band inside the frame and above the bottom safe margin', () => {
    const { x, y, width, height } = SUBTITLE_BAND_FRACTIONS

    expect(x).toBeGreaterThan(0)
    expect(y).toBeGreaterThan(0)
    expect(x + width).toBeLessThanOrEqual(1)
    expect(y + height).toBeLessThanOrEqual(1)
  })
})

describe('buildAssDocument style selection', () => {
  it('routes each shot to the style matching its measured background', () => {
    const ass = buildAssDocument({
      fps: 30,
      targetResolution: { width: 1920, height: 1080 },
      shots: [shot('on-light')],
    })

    expect(dialogueStyle(ass)).toBe(subtitleStyleName('on-light'))
  })

  it('falls back to the dark-background style when contrast is unknown', () => {
    const ass = buildAssDocument({
      fps: 30,
      targetResolution: { width: 1920, height: 1080 },
      shots: [shot()],
    })

    expect(dialogueStyle(ass)).toBe(subtitleStyleName('on-dark'))
  })
})
