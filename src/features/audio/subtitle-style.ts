/**
 * 硬字幕排版真值（唯一事实源）。
 *
 * 这里集中 ASS 画布、字体、边距与两套明暗样式；`subtitle-ass.ts` 只负责时间轴归一化
 * 与文档拼装，不再自己拼 Style 字符串。改动任何一个常量都必须用
 * `scripts/verify/subtitle-layout-shot.ts` 重新取像素证据，不能靠推算。
 *
 * ## 为什么要两套样式
 *
 * 成片的画面是产品截图，底色深浅由被采集站点/风格决定。用单一白字样式时，字身与浅色
 * 底的对比度会塌掉：白 `#ffffff` 压在浅底 `#f4f4f6` 上对比度约 1.05:1，字身实际上
 * 不可见，可读性全靠一圈 2px 描边撑着，看起来是「空心字」。翻转成黑字后同一背景上
 * 对比度约 19.6:1。深色底反过来同理。所以按镜头字幕带的实测明度在两套样式之间二选一
 * （判定见 `features/render/subtitle-contrast.ts`）。
 *
 * 翻转只发生在镜头边界，不会在一句话中间切换，因此读起来是有意的版式而不是闪动。
 *
 * ## 颜色为什么是纯黑纯白
 *
 * 直接取项目自己的文字 token：`src/app/globals.css` 浅色主题 `--color-label: #000000`，
 * 深色主题 `--color-label: #ffffff`。字幕因此与应用同一套明暗配对，不引入新色相
 * （见 docs/conventions/design-quality-pitfalls.md §1.1）。附带好处是这两个值在
 * ASS 的 `&HAABBGGRR` 字节序下是回文，天然避开 BGR 写反的经典错误。
 */

/** 字幕带的背景明暗；决定用哪一套 Style。 */
export type SubtitleContrast = 'on-dark' | 'on-light'

/** ASS 逻辑画布。与 FABRICATE 母版同画幅；libass 会按实际输出分辨率等比缩放。 */
export const SUBTITLE_PLAY_RES_X = 1920
export const SUBTITLE_PLAY_RES_Y = 1080

/**
 * 字体族名与随仓库交付的字体文件。
 *
 * 不能用 `sans-serif`：那把解析权交给宿主 fontconfig，拉丁与中文会落到两个不同的
 * face，同一行里字面大小不一致（实测同一 Fontsize 下 `sans-serif` 的拉丁字面高 33、
 * 显式指定单一字体族时 30），而且解析结果随宿主与依赖版本漂移——运行镜像里显式安装的
 * 只有 fonts-wqy-zenhei，但 `playwright install-deps chromium` 会顺带带进拉丁字体族，
 * 这套组合还会随 Playwright 版本变化。
 *
 * 所以字体随仓库交付，并通过 ffmpeg `ass` 滤镜的 `fontsdir` 显式指定目录，让 dev 与
 * 生产渲染同一份字节。族名用 typographic family（name 表 nameID 16）而不是 legacy
 * family（nameID 1 是 "Noto Sans SC Medium"）：前者在后续增加字重时仍然稳定。两者都
 * 实测能解析（对照组用不存在的族名，结果与无 fontsdir 的回退完全一致）。
 */
export const SUBTITLE_FONT_NAME = 'Noto Sans SC'
export const SUBTITLE_FONT_FILE = 'NotoSansSC-Medium.otf'
/** 字体目录相对仓库根；与 migrate.ts 一样按 `process.cwd()` 解析（Docker 中为 /app）。 */
export const SUBTITLE_FONTS_DIRECTORY = 'assets/fonts'

/**
 * 字号。实测 Noto Sans SC 在 Fontsize 56 下中文前进宽 38.70px，即字面占画幅高
 * 3.58%，落在广播常规的 3.5–4% 区间。换字体会改变「Fontsize → 实际字面」的比值
 * （同为 52 时 `sans-serif` 解析到的字体给 39.00、Noto Sans SC 给 35.90，也就是从
 * 3.6% 掉到 3.32%），所以调整字体必须同时用 `scripts/verify/subtitle-layout-shot.ts`
 * 重新取证。
 */
export const SUBTITLE_FONT_SIZE = 56
/** 左右安全边距，同时是单行字数闸门的宽度预算依据。 */
export const SUBTITLE_MARGIN_X = 120
/** 底部安全边距。 */
export const SUBTITLE_MARGIN_V = 72

/** 单行可用宽度。 */
export const SUBTITLE_USABLE_WIDTH =
  SUBTITLE_PLAY_RES_X - 2 * SUBTITLE_MARGIN_X

/**
 * 单行字数闸门，由可用宽度推导而不是手写。
 *
 * 全角字的前进宽最坏等于 Fontsize（1.0 em），因此 floor(可用宽度 / Fontsize) 是「无论
 * 字体的垂直度量把 Fontsize 折算成多大字面，单行都不溢出安全区」的上界。当前取值 30
 * （1680 / 56）；按实测前进宽 38.70 计算，30 字实际只占约 1161px，留了约 30% 余量。
 *
 * 推导而非写死的意义：改 Fontsize 时闸门自动跟随，不会出现「字号调大了但闸门没跟着调
 * 小」这类只在长句子上暴露的溢出。`subtitle-style.test.ts` 锁定该不变量，
 * `subtitle-ass.test.ts` 用真实 ffmpeg 在闸门上限渲染并核对未越出安全区。
 *
 * 闸门不削减内容：MAX_CUE_MS 4000ms 配合中文旁白约 5 字/秒，真实 cue 长度上限在 20
 * 字左右，闸门只是溢出保险。
 *
 * libass 不能替代这道闸门——它的智能换行只在空格等断词机会处生效，连续中文没有任何
 * 断点，超长行会直接画到画面外被裁掉（实测 50 字一行墨迹横跨 x=0..1919）。
 */
export const SUBTITLE_MAX_LINE_GRAPHEMES = Math.floor(
  SUBTITLE_USABLE_WIDTH / SUBTITLE_FONT_SIZE
)

/**
 * 字幕带在画面中的位置，以画幅比例表示。
 *
 * 用比例而不是像素：探针读的是分镜自己的 mp4，虽然母版是 1920x1080，但用比例可以
 * 让 crop 表达式对任何输入尺寸都成立，不会因为某个分镜画幅不同而整个探针失败。
 */
export const SUBTITLE_BAND_FRACTIONS = {
  x: SUBTITLE_MARGIN_X / SUBTITLE_PLAY_RES_X,
  width: SUBTITLE_USABLE_WIDTH / SUBTITLE_PLAY_RES_X,
  y:
    (SUBTITLE_PLAY_RES_Y - SUBTITLE_MARGIN_V - SUBTITLE_FONT_SIZE * 2)
    / SUBTITLE_PLAY_RES_Y,
  height: (SUBTITLE_FONT_SIZE * 2) / SUBTITLE_PLAY_RES_Y,
} as const

const STYLE_NAMES: Record<SubtitleContrast, string> = {
  'on-dark': 'OnDark',
  'on-light': 'OnLight',
}

export function subtitleStyleName(contrast: SubtitleContrast): string {
  return STYLE_NAMES[contrast]
}

export const SUBTITLE_STYLE_FORMAT =
  'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,'
  + 'BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,'
  + 'BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding'

const WHITE = '&H00FFFFFF'
const BLACK = '&H00000000'
const BLACK_HALF = '&H80000000'

/**
 * BorderStyle 1 = 描边 + 投影（不是 BorderStyle 3 的不透明底板）。
 * 实测底板方案的深色覆盖占画面 2.59%，描边方案降到 0.66%，且不会在换行时裂成两条
 * 宽度不等的板。浅色底描边更粗（3 而非 2），因为白色光晕要把黑字从明亮且有纹理的
 * 截图里托起来；深色底的黑描边只需做边缘定义。
 */
const STYLE_SPECS: Record<
  SubtitleContrast,
  { primary: string; outline: string; back: string; outlineWidth: number; shadow: number }
> = {
  'on-dark': {
    primary: WHITE,
    outline: BLACK,
    back: BLACK_HALF,
    outlineWidth: 2,
    shadow: 1,
  },
  'on-light': {
    primary: BLACK,
    outline: WHITE,
    back: WHITE,
    outlineWidth: 3,
    shadow: 0,
  },
}

/** 两套 Style 行；Dialogue 按镜头引用其中之一。 */
export function subtitleStyleLines(): string[] {
  return (Object.keys(STYLE_SPECS) as SubtitleContrast[]).map((contrast) => {
    const spec = STYLE_SPECS[contrast]
    return [
      `Style: ${STYLE_NAMES[contrast]}`,
      SUBTITLE_FONT_NAME,
      String(SUBTITLE_FONT_SIZE),
      spec.primary,
      spec.primary,
      spec.outline,
      spec.back,
      '0', // Bold
      '0', // Italic
      '0', // Underline
      '0', // StrikeOut
      '100', // ScaleX
      '100', // ScaleY
      '0', // Spacing
      '0', // Angle
      '1', // BorderStyle：描边 + 投影
      String(spec.outlineWidth),
      String(spec.shadow),
      '2', // Alignment：底部居中
      String(SUBTITLE_MARGIN_X),
      String(SUBTITLE_MARGIN_X),
      String(SUBTITLE_MARGIN_V),
      '1', // Encoding
    ].join(',')
  })
}
