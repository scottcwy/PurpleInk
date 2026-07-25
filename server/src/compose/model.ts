// 把官方 capture/ 目录解析成一个「视频模型」(VideoModel)。
// 这是方案 B(模板驱动)的第一步：capture/ 的品牌/文案/截图 → 结构化槽位 + 场景时序。
// template.ts 消费本模型生成 index.html；不依赖任何 LLM。
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import sharp from "sharp"
import type { PageTokens } from "../adapter/types"

/**
 * 镜头（shot）类型：每种是 template.ts 的 SHOTS 注册表里一段独立的 HTML+GSAP 片段。
 * 故事板选择器（selectStoryboard）按素材 + 域名 seed 从中选 8-12 个拼成一支视频。
 */
export type ShotType =
  | "brand-center"
  | "brand-side"
  | "hero-split"
  | "hero-stack"
  | "shot-window"
  | "shot-tilt"
  | "shot-zoom"
  | "shot-split"
  | "feature-row"
  | "feature-stack"
  | "data-counter"
  | "chips-marquee"
  | "logo-wall"
  | "pricing"
  | "cta-push"
  | "cta-fullbleed"

/** 兼容旧命名 */
export type SceneKind = ShotType

/** 截图素材（一张 showcase 截图 + 说明） */
export interface ShotMaterial {
  src: string
  caption: string
  tall: boolean
}

/** data-counter 镜头的单条统计（value 直接来自采集文本，绝不编造） */
export interface Stat {
  value: string
  label: string
}

/** 定价套餐（name + price 直接来自采集，绝不编造） */
export interface PricingTier {
  name: string
  price: string
}

/** 单个场景/镜头（含在时间线上的起点/时长，单位秒） */
export interface Scene {
  kind: ShotType
  start: number
  duration: number
  /** 截图镜头使用的素材：window/tilt/zoom 用 1 张，split 用 2 张 */
  shots?: ShotMaterial[]
  /** data-counter 专用统计 */
  stats?: Stat[]
}

/** 品牌调色板（全部 hex，保证前景/背景对比达 AA） */
export interface Palette {
  fg: string
  bg: string
  accent: string
  accentFg: string
  muted: string
  secondary: string
  border: string
  fontFamily: string
}

/**
 * 视觉系统(皮肤)：决定一支视频的整体"长相"——不只是镜头顺序。
 * 每套 = 布局网格 + 背景处理 + 字体尺度/字重 + 配色应用 + 运镜签名(ease/转场)。
 * 三套差异拉满：editorial(大留白/缓)、kinetic(满屏强调色/大字/闪白硬切)、technical(等宽/网格线/紧凑)。
 */
export type VisualSystemId = "editorial" | "kinetic" | "technical"

export interface Motion {
  /** 主入场缓动(GSAP ease 名) */
  enter: string
  /** 皮肤级转场签名：crossfade 软叠化 / flash 闪白硬切 / cut 纯硬切 */
  transition: "crossfade" | "flash" | "cut"
}

/**
 * 品牌动效预设：从品牌调性(能量轴 × 调性轴)推导出的完整动效参数。
 * 控制入场/退场缓动、过冲量、Squash & Stretch、转场类型、Stagger 间隔等。
 */
export interface MotionProfile {
  /** 入场缓动 (GSAP ease) */
  enterEase: string
  /** 基础入场时长 (秒) */
  enterDuration: number
  /** 退场缓动 */
  exitEase: string
  /** 退场时长 (秒) */
  exitDuration: number
  /** 过冲量 (back ease 的 overshoot): 0 = 无, 1.5 = 明显 */
  overshoot: number
  /** Squash & Stretch 幅度: 0 = 无, 0.15 = 明显 */
  squash: number
  /** 转场类型 */
  transition: "crossfade" | "flash" | "cut" | "wipe"
  /** 子元素逐个入场的间隔 (秒) */
  stagger: number
}

/** 品牌调性轴 */
export type BrandTone = "bold" | "calm" | "technical"
/** 品牌能量轴 */
export type BrandEnergy = "low" | "medium" | "high"

/**
 * 根据品牌调性推导动效参数。
 * 6 种预设 = 能量(low/medium/high) × 调性(technical/editorial/kinetic)。
 */
export function deriveMotionProfile(tone: BrandTone, energy: BrandEnergy): MotionProfile {
  // 技术/严肃调性
  if (tone === "technical") {
    if (energy === "low") {
      return { enterEase: "expo.out", enterDuration: 1.0, exitEase: "expo.in", exitDuration: 0.6, overshoot: 0, squash: 0, transition: "crossfade", stagger: 0.18 }
    }
    if (energy === "medium") {
      return { enterEase: "power3.out", enterDuration: 0.85, exitEase: "power3.in", exitDuration: 0.5, overshoot: 0.4, squash: 0, transition: "crossfade", stagger: 0.14 }
    }
    // high
    return { enterEase: "power4.out", enterDuration: 0.7, exitEase: "power4.in", exitDuration: 0.4, overshoot: 0.8, squash: 0.05, transition: "flash", stagger: 0.1 }
  }
  // 中性/editorial 调性
  if (tone === "calm") {
    if (energy === "low") {
      return { enterEase: "power2.out", enterDuration: 1.1, exitEase: "power2.in", exitDuration: 0.7, overshoot: 0, squash: 0, transition: "crossfade", stagger: 0.2 }
    }
    if (energy === "medium") {
      return { enterEase: "power2.out", enterDuration: 0.9, exitEase: "power2.in", exitDuration: 0.55, overshoot: 0.3, squash: 0, transition: "crossfade", stagger: 0.15 }
    }
    // high
    return { enterEase: "back.out(1.2)", enterDuration: 0.75, exitEase: "back.in(1.2)", exitDuration: 0.45, overshoot: 0.8, squash: 0.08, transition: "wipe", stagger: 0.12 }
  }
  // 活泼/kinetic 调性
  if (energy === "low") {
    return { enterEase: "power2.out", enterDuration: 0.95, exitEase: "power2.in", exitDuration: 0.55, overshoot: 0.3, squash: 0.05, transition: "crossfade", stagger: 0.16 }
  }
  if (energy === "medium") {
    return { enterEase: "back.out(1.5)", enterDuration: 0.8, exitEase: "back.in(1.5)", exitDuration: 0.45, overshoot: 1.0, squash: 0.1, transition: "wipe", stagger: 0.1 }
  }
  // high
  return { enterEase: "back.out(2)", enterDuration: 0.65, exitEase: "back.in(2)", exitDuration: 0.35, overshoot: 1.5, squash: 0.15, transition: "flash", stagger: 0.08 }
}

/**
 * 从品牌域名/产品名自动推导 energy 和 tone。
 * 基于关键词匹配：
 * - enterprise/cloud/data → technical + low
 * - design/creative/art → kinetic + medium
 * - startup/social/fun → kinetic + high
 * - 默认 → calm + medium
 */
export function detectBrandProfile(nameOrDomain: string): { tone: BrandTone; energy: BrandEnergy } {
  const t = (nameOrDomain || "").toLowerCase()
  const has = (words: string[]) => words.some((w) => t.includes(w))

  // 严肃/技术类
  if (has(["enterprise", "cloud", "data", "infra", "backend", "devops", "api", "server", "database"])) {
    return { tone: "technical", energy: "low" }
  }
  // 设计/创意类
  if (has(["design", "creative", "art", "studio", "figma", "sketch", "motion"])) {
    return { tone: "bold", energy: "medium" }
  }
  // 社交/活泼类
  if (has(["startup", "social", "fun", "play", "game", "party", "community"])) {
    return { tone: "bold", energy: "high" }
  }
  // 组件/UI工具类 → 技术 + 中能量
  if (has(["component", "ui", "kit", "library", "framework", "registry"])) {
    return { tone: "technical", energy: "medium" }
  }
  // 默认
  return { tone: "calm", energy: "medium" }
}

export interface VisualSystem {
  id: VisualSystemId
  motion: Motion
  /** 每镜最短时长(秒)：越大越"少剪、慢"；越小越"多剪、快" */
  minShot: number
  /** 镜头数上限 */
  maxShots: number
}

/** 视频模型：模板渲染所需的一切 */
export interface VideoModel {
  id: string
  name: string
  brand: { title: string; tagline: string }
  hero: { headline: string; lede: string; ctas: string[]; chips: string[] }
  valueProps: Array<{ title: string; desc: string }>
  /** logo 墙品牌名（HTML 原生重绘，无则该镜头不出现） */
  logos: string[]
  /** 定价套餐（HTML 原生重绘，<2 条则该镜头不出现） */
  pricing: PricingTier[]
  cta: { headline: string; command: string }
  palette: Palette
  /** 本站选中的视觉系统(异站分化到"皮肤"层，不只镜头顺序) */
  skin: VisualSystem
  /** 品牌动效预设：从品牌调性推导的完整动效参数（向后兼容，可选） */
  motionProfile?: MotionProfile
  scenes: Scene[]
  durationSec: number
}

interface BuildModelOptions {
  /** 目标总时长（秒），默认 30 */
  durationSec?: number
  /** 覆盖展示名 */
  name?: string
}

const DEFAULT_PALETTE: Palette = {
  fg: "#0a0a0a",
  bg: "#ffffff",
  accent: "#0a0a0a",
  accentFg: "#fafafa",
  muted: "#737373",
  secondary: "#f5f5f5",
  border: "#e5e5e5",
  fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
}

// ---------- 颜色工具 ----------

/** 规范成 #rrggbb；无法识别返回 null */
function normalizeHex(input: string | undefined): string | null {
  if (!input) return null
  let v = input.trim().toLowerCase()
  const m = v.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (!m) return null
  v = m[1]!
  if (v.length === 3) v = v.split("").map((c) => c + c).join("")
  return "#" + v
}

function rgb(hex: string): [number, number, number] {
  const h = hex.slice(1)
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] as [number, number, number]
}

/** 相对亮度（WCAG） */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 对比度（WCAG，1..21） */
function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 饱和度粗估（0..1)，用于挑「品牌强调色」 */
function saturation(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => c / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

/** 返回 HSL 色相角度 0-360 */
function hue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max === min) return 0
  const d = max - min
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return h
}

/** 前景色：在 bg 上对比 >=4.5 的深/浅色 */
function readableOn(bg: string): string {
  return luminance(bg) > 0.5 ? "#0a0a0a" : "#fafafa"
}

/**
 * 从 tokens 派生调色板：优先站点主色，但强制保证对比达 AA，
 * 否则渲染的 check(对比度 gate)会挂。缺色则回落到 shadcn 中性色。
 *
 * 扩展：支持自定义 CSS 变量（如通义千问的 --C50: #625cf6），
 * 扫描所有 --[A-Z][0-9]+ 格式变量，按色相分组提取品牌色。
 */
function derivePalette(tokens: PageTokens | null): Palette {
  if (!tokens) return DEFAULT_PALETTE
  const hexes: string[] = []
  for (const c of tokens.colors || []) {
    const h = normalizeHex(c)
    if (h) hexes.push(h)
  }
  // cssVariables 里只收 hex 值
  const vars = tokens.cssVariables || {}
  const varHex = (k: string) => normalizeHex(vars[k])

  // --- 扫描自定义 CSS 变量（--[A-Z][0-9]+ 格式，如 --C50, --N100）---
  const customHexes: string[] = []
  const customVarPattern = /^--[A-Z][0-9]+$/
  for (const [key, val] of Object.entries(vars)) {
    if (customVarPattern.test(key)) {
      const h = normalizeHex(val)
      if (h) customHexes.push(h)
    }
  }

  const uniq = Array.from(new Set([...hexes, ...customHexes]))
  const lightest = uniq.slice().sort((a, b) => luminance(b) - luminance(a))[0]
  const darkest = uniq.slice().sort((a, b) => luminance(a) - luminance(b))[0]
  // 频次表：colorStats 里每个 hex 的出现次数。品牌强调色一定是高频色，
  // 罕见的图标色(如 supabase 的 #0070F3 count=1)不能当主色。
  const countOf = new Map<string, number>()
  for (const s of tokens.colorStats || []) {
    const h = normalizeHex(s.hex)
    if (h) countOf.set(h, s.count ?? 0)
  }

  let bg = varHex("--background") || lightest || DEFAULT_PALETTE.bg
  let fg = varHex("--foreground") || darkest || DEFAULT_PALETTE.fg
  // 背景应偏亮；若挑出来的 bg 偏暗且有更亮候选，交换
  if (luminance(bg) < 0.4 && lightest && luminance(lightest) > luminance(bg)) bg = lightest
  // 保证正文可读
  if (contrast(fg, bg) < 4.5) fg = readableOn(bg)

  // 强调色：优先 --primary；否则在「够饱和 + 在 bg 上够醒目(对比≥3)」的候选里，
  // 选出现频次最高的（品牌色必然高频；蓝/紫等罕见图标色会被频次与对比双重过滤掉），
  // 频次相同再比饱和度。这样 supabase 会落到品牌绿 #15593B 而非罕见蓝 #0070F3。
  // 自定义变量（--C50 等）也纳入候选。
  let accent = varHex("--primary") || ""
  if (!accent) {
    const candidates = uniq
      .filter((h) => {
        // 排除与 bg 同色系（色相差 < 30°）的颜色
        if (Math.abs(hue(h) - hue(bg)) < 30) return false
        return saturation(h) > 0.25 && contrast(h, bg) >= 3
      })
      .sort((a, b) => {
        const ca = countOf.get(a) ?? 0
        const cb = countOf.get(b) ?? 0
        if (cb !== ca) return cb - ca
        return saturation(b) - saturation(a)
      })
    accent = candidates[0] || fg
  }
  // 确保 accent 与 bg 有足够对比度（WCAG AA 4.5:1 for text）
  if (contrast(accent, bg) < 3) accent = fg
  if (contrast(accent, bg) < 4.5 && accent !== fg) {
    // 尝试加深/减淡 accent 以满足 AA
    const bgLum = luminance(bg)
    // 如果背景亮，accent 需要更暗；反之更亮
    const adjusted = bgLum > 0.5 ? darkenUntilContrast(accent, bg, 4.5) : lightenUntilContrast(accent, bg, 4.5)
    if (adjusted && contrast(adjusted, bg) >= 4.5) accent = adjusted
  }
  const accentFg = readableOn(accent)

  const family = tokens.fonts?.[0]?.family
    ? `"${tokens.fonts[0].family.replace(/["']/g, "")}", ${DEFAULT_PALETTE.fontFamily}`
    : DEFAULT_PALETTE.fontFamily

  const secondary = varHex("--secondary") || DEFAULT_PALETTE.secondary
  // muted 常铺在 bg/secondary（浅灰）上；确保达 AA(4.5)，否则自动调深，护住所有次要文本
  let muted = varHex("--muted-foreground") || DEFAULT_PALETTE.muted
  if (contrast(muted, bg) < 4.5 || contrast(muted, secondary) < 4.5) {
    muted = luminance(bg) > 0.5 ? "#595959" : "#a3a3a3"
  }

  return {
    fg,
    bg,
    accent,
    accentFg,
    muted,
    secondary,
    border: varHex("--border") || DEFAULT_PALETTE.border,
    fontFamily: family,
  }
}

/** 逐步加深颜色直到与背景对比度达标 */
function darkenUntilContrast(hex: string, bg: string, target: number): string | null {
  const [r, g, b] = rgb(hex)
  for (let factor = 0.9; factor >= 0.1; factor -= 0.1) {
    const nr = Math.round(r * factor)
    const ng = Math.round(g * factor)
    const nb = Math.round(b * factor)
    const candidate = `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`
    if (contrast(candidate, bg) >= target) return candidate
  }
  return null
}

/** 逐步减淡颜色直到与背景对比度达标 */
function lightenUntilContrast(hex: string, bg: string, target: number): string | null {
  const [r, g, b] = rgb(hex)
  for (let factor = 1.1; factor <= 3.0; factor += 0.1) {
    const nr = Math.min(255, Math.round(r * factor))
    const ng = Math.min(255, Math.round(g * factor))
    const nb = Math.min(255, Math.round(b * factor))
    const candidate = `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`
    if (contrast(candidate, bg) >= target) return candidate
  }
  return null
}

// ---------- 文本解析 ----------

interface TextBuckets {
  h1: string[]
  h2: string[]
  h3: string[]
  p: string[]
  button: string[]
  link: string[]
}

/** 解析 visible-text.txt 的 `[tag] 文本` 行 */
function parseVisibleText(raw: string): TextBuckets {
  const b: TextBuckets = { h1: [], h2: [], h3: [], p: [], button: [], link: [] }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\[([a-z0-9]+)\]\s*(.+)$/i)
    if (!m) continue
    const tag = m[1]!.toLowerCase()
    const text = m[2]!.trim()
    if (!text) continue
    if (tag === "h1") b.h1.push(text)
    else if (tag === "h2") b.h2.push(text)
    else if (tag === "h3" || tag === "h4") b.h3.push(text)
    else if (tag === "p") b.p.push(text)
    else if (tag === "button") b.button.push(text)
    else if (tag === "a") b.link.push(text)
  }
  return b
}

/** 去掉站点标题里的 " | xxx" / " - xxx" 后缀，取主名 */
function primaryTitle(title: string): string {
  return title.split(/[|·–—-]/)[0]!.trim() || title.trim()
}

function dedupe(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => s.trim()).filter(Boolean)))
}

// ---------- 字幕来源清洗（禁内部占位/泛描述进入成品） ----------

/** 内部占位标签(补充截图 N / 页面截图 N)与视觉模型泛描述开头，绝不允许进字幕 */
const BANNED_CAPTION =
  /(补充截图|页面截图|documentation page|this (?:screenshot|image|page)\b|the (?:screenshot|image|page)\b|displays? the|showcas|screenshot (?:shows|displays)|preview of|marketing$)/i

/** 清洗一条候选字幕：折叠空白、去首尾标点/引号/项目符号 */
function cleanCaption(s: string): string {
  return (s || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”\-–—•·]+|["'“”\-–—•·]+$/g, "")
    .trim()
}

/** 是否内部占位/泛描述 —— 命中即拒 */
function isBannedCaption(s: string): boolean {
  return !s || BANNED_CAPTION.test(s)
}

/**
 * 字幕换源：只从页面真实标题/卖点(h2/h3/标签)派生短句，短、利益导向。
 * 绝不使用 asset 描述（会带 "补充截图 N — marketing" 内部标签或
 * "A documentation page displaying…" 泛描述）。
 */
function buildCaptionPool(b: TextBuckets, chips: string[]): string[] {
  return dedupe([...b.h2, ...b.h3, ...chips])
    .map(cleanCaption)
    .filter((t) => t.length >= 6 && t.length <= 42 && !isBannedCaption(t))
}

/** 从 asset-descriptions.md 解析 `- path — 描述` */
function parseAssetDescriptions(raw: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^-\s*(\S+)\s*[—-]\s*(.+)$/)
    if (m) map.set(m[1]!.trim(), m[2]!.trim())
  }
  return map
}

// ---------- 读盘 ----------

async function readJsonSafe<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch {
    return null
  }
}

async function readTextSafe(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return ""
  }
}

async function listAssets(assetsDir: string): Promise<string[]> {
  try {
    const files = await readdir(assetsDir)
    return files
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .sort()
      .map((f) => `assets/${f}`)
  } catch {
    return []
  }
}

/**
 * ④ 内容密度筛选：丢弃近空白截图(不拿来凑镜头)，并按密度降序——
 * 让内容最丰富的真·产品 UI 优先入选（取前 MAX_SHOT_SCENES 张）。
 * 纯色/空白图的通道标准差≈ 0；stats 读不了则不因密度误丢。结果确定性(同站稳定)。
 */
async function filterDenseAssets(captureDir: string, rels: string[]): Promise<string[]> {
  const DENSITY_MIN = 8
  const scored = await Promise.all(
    rels.map(async (rel) => {
      try {
        const { channels } = await sharp(join(captureDir, rel)).stats()
        const d = channels.length ? channels.reduce((a, c) => a + c.stdev, 0) / channels.length : 0
        return { rel, d }
      } catch {
        return { rel, d: 999 }
      }
    })
  )
  const dense = scored.filter((s) => s.d >= DENSITY_MIN)
  // 全都被判空白时不砸手（保留原集），避免空产物；否则只留密集帧
  const use = dense.length ? dense : scored
  return use.sort((a, b) => b.d - a.d).map((s) => s.rel)
}

// ---------- 场景时序 ----------

/** 每镜最短时长（秒）：镜头数受 floor(total/MIN) 约束，避免一闪而过 */
const MIN_SHOT_SEC = 2.2

/**
 * ③ 截图镜头上限：截图只作「真·产品 UI 证据」，限量 + 降权，避免纯缩放/平移刷屏；
 * 其余叙事优先用 HTML 重绘镜头（大字卡/数字滚动/列表揭示/标签跑马灯）。
 */
const MAX_SHOT_SCENES = 3

/** 故事板一条目：镜头类型 + 权重 + 可选素材 */
interface StoryEntry {
  kind: ShotType
  weight: number
  shots?: ShotMaterial[]
  stats?: Stat[]
}

/**
 * 按权重把总时长分配给一组镜头，并强制每镜 >= MIN_SHOT_SEC：
 * 先按权重初分，把不足 MIN 的补到 MIN，再从可压缩(>MIN)的镜头按比例回收超出量。
 */
function layoutScenes(entries: StoryEntry[], total: number, minShot: number = MIN_SHOT_SEC): Scene[] {
  const sum = entries.reduce((a, k) => a + k.weight, 0) || 1
  const durs = entries.map((k) => (k.weight / sum) * total)
  for (let i = 0; i < durs.length; i++) if (durs[i]! < minShot) durs[i] = minShot
  let over = durs.reduce((a, d) => a + d, 0) - total
  let guard = 0
  while (over > 0.01 && guard++ < 100) {
    const flex = durs.map((d) => Math.max(0, d - minShot))
    const flexSum = flex.reduce((a, d) => a + d, 0)
    if (flexSum <= 0.01) break
    for (let i = 0; i < durs.length; i++) durs[i]! -= (flex[i]! / flexSum) * over
    over = durs.reduce((a, d) => a + d, 0) - total
  }
  const scenes: Scene[] = []
  let cursor = 0
  for (let i = 0; i < entries.length; i++) {
    // 最后一个镜头吃掉剩余时长，避免累计误差
    const dur = i === entries.length - 1 ? Math.max(minShot, total - cursor) : Math.round(durs[i]! * 10) / 10
    scenes.push({
      kind: entries[i]!.kind,
      start: Math.round(cursor * 10) / 10,
      duration: Math.round(dur * 10) / 10,
      ...(entries[i]!.shots ? { shots: entries[i]!.shots } : {}),
      ...(entries[i]!.stats ? { stats: entries[i]!.stats } : {}),
    })
    cursor = Math.round((cursor + dur) * 10) / 10
  }
  return scenes
}

// ---------- 故事板选择器 ----------

/** 32-bit FNV 域名哈希 → 稳定 seed（同站同 seed，异站不同） */
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32：由 seed 产生确定性伪随机序列（不用 Math.random，保证同站稳定） */
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 从可见文本里提取「真实统计数字」（形如 106.8K / 100% / 10x），无则返回空（绝不编造） */
function extractStats(b: TextBuckets): Stat[] {
  const lines = [...b.h1, ...b.h2, ...b.h3, ...b.p, ...b.link, ...b.button]
  const out: Stat[] = []
  const seen = new Set<string>()
  const re = /(\d[\d.,]*)\s?(%|x|K|M|B|\+|million|billion)/i
  for (const line of lines) {
    const m = line.match(re)
    if (!m) continue
    const value = (m[1]! + (m[2]! || "")).replace(/\s+/g, "")
    if (seen.has(value)) continue
    // label：去掉数值片段后取相邻短语（首个分隔符前），空则跳过——不硬凑
    let label = line.replace(m[0], " ").replace(/\s+/g, " ").trim()
    label = label.split(/[.,;:—-]/)[0]!.trim().slice(0, 22)
    if (!label) continue
    seen.add(value)
    out.push({ value, label })
    if (out.length >= 3) break
  }
  return out
}

// ---------- 视觉系统(皮肤)选择 ----------

/** 三套差异拉满的视觉系统预设 */
const VISUAL_SYSTEMS: Record<VisualSystemId, VisualSystem> = {
  // 大留白、大图 UI、缓慢推拉、少剪、软叠化转场
  editorial: { id: "editorial", motion: { enter: "power2.out", transition: "crossfade" }, minShot: 3.0, maxShots: 7 },
  // 满屏强调色、大字、快剪 + 闪白转场、高能量
  kinetic: { id: "kinetic", motion: { enter: "expo.out", transition: "flash" }, minShot: 2.0, maxShots: 12 },
  // 等宽字/网格线/终端感、紧凑硬切、双色调
  technical: { id: "technical", motion: { enter: "power4.out", transition: "cut" }, minShot: 2.4, maxShots: 9 },
}

/** 从采集文案 + 配色 + 字体派生的调性信号 */
interface ToneSignals {
  text: string
  accentSat: number
  accentNeutral: boolean
  monoFont: boolean
}

/**
 * 按「产品调性(采集文案+配色) + 域名 seed」为一个站选一套视觉系统：
 * - kinetic：动效/交互/视觉冲击类关键词密集(magicui 这类)。
 * - technical：中性(近黑白)配色 / 等宽字 / UI 组件工具类关键词(shadcn 这类)。
 * - editorial：有饱和品牌色的产品站(supabase 这类)。
 * - 都不命中：seed 决定(同站稳定)。
 */
function selectVisualSystem(sig: ToneSignals, seed: number): VisualSystem {
  const t = sig.text.toLowerCase()
  const has = (words: string[]) => words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0)
  // 高能量/动效信号
  const kinetic = has([
    "animat", "motion", "effect", "interactive", "magic", "stunning", "beautiful",
    "dynamic", "particle", "marquee", "hover", "transition", "design engineer", "gradient",
  ])
  // UI 组件工具/终端感信号(只针对组件库这类，避免误判后端产品)
  const techUI = has([
    "component", "registry", "copy", "paste", "cli", "npm", "tailwind",
    "primitive", "headless", "snippet", "terminal", "monorepo", "classname", "open source",
  ])
  if (kinetic >= 2) return VISUAL_SYSTEMS.kinetic!
  if (sig.accentNeutral || sig.monoFont || techUI >= 2) return VISUAL_SYSTEMS.technical!
  if (sig.accentSat >= 0.25) return VISUAL_SYSTEMS.editorial!
  const pool = [VISUAL_SYSTEMS.editorial, VISUAL_SYSTEMS.kinetic, VISUAL_SYSTEMS.technical]
  const rng = makeRng((seed ^ 0x9e3779b9) >>> 0)
  return pool[Math.floor(rng() * pool.length) % pool.length]!
}

interface StoryboardInput {
  seedKey: string
  shots: ShotMaterial[]
  stats: Stat[]
  chips: number
  valueProps: number
  logos: number
  pricing: number
}

/**
 * 按素材 + 域名 seed 选 8-12 个镜头拼故事板：
 * - 同站稳定：纯 seed 驱动（hostname → mulberry32），无 Math.random。
 * - 异站不同：seed 不同 + 素材(截图数/统计/标签)不同 → 镜头组合与顺序都不同。
 * - 镜头数受 floor(total/MIN_SHOT_SEC) 约束并夹在 [.., 12]，避免一闪而过。
 */
function selectStoryboard(input: StoryboardInput, total: number, skin: VisualSystem): StoryEntry[] {
  const seed = hashSeed(input.seedKey)
  const rng = makeRng(seed)
  const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length) % arr.length]!

  // 1) 开场品牌 + 2) 英雄：按皮肤偏置构图
  //    kinetic 走居中大字(brand-center/hero-stack)；technical 走带栏侧栏(brand-side/hero-split)；editorial 随 seed。
  const brandKind: ShotType =
    skin.id === "kinetic" ? "brand-center" : skin.id === "technical" ? "brand-side" : pick<ShotType>(["brand-center", "brand-side"])
  const heroKind: ShotType =
    skin.id === "kinetic" ? "hero-stack" : skin.id === "technical" ? "hero-split" : pick<ShotType>(["hero-split", "hero-stack"])
  const brand: StoryEntry = { kind: brandKind, weight: 4.5 }
  const hero: StoryEntry = { kind: heroKind, weight: 6 }

  // 3) 主体池：翻转主次——HTML 原生重绘为默认/核心，截图降级为「真实产品 UI 证据」点缀。
  const body: StoryEntry[] = []
  // 结构化内容够丰富(功能≥3 / logo≥4 / 指标≥2 / 定价≥2)时，截图退为 ≤1 张点缀；否则至多 2 张。
  const htmlRich =
    input.valueProps >= 3 || input.logos >= 4 || input.stats.length >= 2 || input.pricing >= 2
  const screenshotBudget = Math.min(htmlRich ? 1 : 2, input.shots.length, MAX_SHOT_SCENES)
  // 截图统一走「套浏览器壳」的 shot-window(产品主视觉证据)，低权重，绝不做纯缩放/平移刷屏。
  input.shots.slice(0, screenshotBudget).forEach((s) => {
    body.push({ kind: "shot-window", weight: 4, shots: [s] })
  })
  // HTML 重绘镜头为叙事主体(权重高于截图)：功能卡错落 / logo 行 / 定价 / 数字滚动 / 标签跑马灯。
  if (input.valueProps > 0) {
    // kinetic 用横排大卡(feature-row)；editorial/technical 用堆叠清单(feature-stack)。两种都放。
    const featKind: ShotType = skin.id === "kinetic" ? "feature-row" : "feature-stack"
    body.push({ kind: featKind, weight: 7 })
    body.push({ kind: featKind === "feature-row" ? "feature-stack" : "feature-row", weight: 6 })
  }
  if (input.logos >= 4) body.push({ kind: "logo-wall", weight: 5.5 })
  if (input.pricing >= 2) body.push({ kind: "pricing", weight: 6 })
  if (input.stats.length >= 2) body.push({ kind: "data-counter", weight: 6.5, stats: input.stats.slice(0, 3) })
  if (input.chips >= 3) body.push({ kind: "chips-marquee", weight: 5 })

  // seed 驱动的 Fisher-Yates 洗牌：同站稳定、异站不同
  for (let i = body.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[body[i]!, body[j]!] = [body[j]!, body[i]!]
  }

  // 4) 结尾 CTA：kinetic 满屏收束(cta-fullbleed)；editorial 留白命令(cta-push)；technical 随 seed。
  const ctaKind: ShotType =
    skin.id === "kinetic" ? "cta-fullbleed" : skin.id === "editorial" ? "cta-push" : pick<ShotType>(["cta-push", "cta-fullbleed"])
  const cta: StoryEntry = { kind: ctaKind, weight: 3 }

  // 5) 计数上限：受皮肤 minShot(剪切密度) + maxShots 双重约束；预留 brand/hero/cta 三镜
  const targetMax = Math.min(skin.maxShots, Math.max(3, Math.floor(total / skin.minShot)))
  const bodyBudget = Math.max(1, targetMax - 3)
  return [brand, hero, ...body.slice(0, bodyBudget), cta]
}

// ---------- 主入口 ----------

/**
 * 读取一个 capture/ 目录，构建 VideoModel。
 * @param captureDir 官方 capture/ 目录（含 meta.json / extracted/ / assets/）
 */
export async function buildVideoModel(captureDir: string, options: BuildModelOptions = {}): Promise<VideoModel> {
  const durationSec = options.durationSec ?? 30
  const meta = (await readJsonSafe<{ id?: string; name?: string }>(join(captureDir, "meta.json"))) || {}
  const tokens = await readJsonSafe<PageTokens>(join(captureDir, "extracted", "tokens.json"))
  const visible = parseVisibleText(await readTextSafe(join(captureDir, "extracted", "visible-text.txt")))
  const descs = parseAssetDescriptions(await readTextSafe(join(captureDir, "extracted", "asset-descriptions.md")))
  // ④ 先按内容密度筛选/排序：丢弃近空白截图，密集的真·产品 UI 优先
  const assetPaths = await filterDenseAssets(captureDir, await listAssets(join(captureDir, "assets")))

  const name = options.name || meta.name || tokens?.title || meta.id || "Untitled"
  const palette = derivePalette(tokens)

  // 品牌
  const title = primaryTitle(tokens?.title || visible.h1[0] || name)
  const tagline = (tokens?.description || visible.h2[0] || visible.p[0] || "").slice(0, 90)

  // hero 文案
  const headline = (visible.h1[0] || tokens?.title || title).slice(0, 80)
  const lede = (visible.h2[0] || visible.p.find((p) => p.length > 24) || tagline || "").slice(0, 160)
  const ctas = dedupe([...visible.button, ...visible.link]).filter((t) => t.length <= 24).slice(0, 2)
  const chips = dedupe([...visible.h3, ...visible.button, ...visible.link])
    .filter((t) => t.length >= 3 && t.length <= 22 && !ctas.includes(t))
    .slice(0, 6)

  // 价值卡：翻转优先级——优先用采集到的结构化功能块(真实标题+描述)，让 HTML 重绘的功能卡
  //   场景有真内容支撑；不足(<2 条)再回退 h2/h3，最后才用通用兜底。
  const c = tokens?.content
  const contentFeatures = (c?.features || [])
    .filter((f) => f.title && f.desc)
    .map((f) => ({ title: f.title.slice(0, 28), desc: f.desc.slice(0, 120) }))
  // 当 content.features 不足时，从 visible-text.txt 的 h2/h3 标题提取功能描述
  // 不使用 "Fast/Reliable/Simple" 这种通用占位文字
  const headingFeatures: Array<{ title: string; desc: string }> = []
  if (contentFeatures.length < 2) {
    const h2h3 = dedupe([...visible.h2, ...visible.h3])
      .filter((t) => t.length >= 3 && t.length <= 28)
      .slice(0, 3)
    for (const title of h2h3) {
      // 找一段与标题不同的描述文本（优先 h3 下方的 p，否则全局 p）
      const desc = visible.p.find((p) => p !== title && p.length > 20)?.slice(0, 110) || ""
      if (desc) {
        headingFeatures.push({ title: title.slice(0, 24), desc })
      }
    }
  }
  const valueProps =
    contentFeatures.length >= 2
      ? contentFeatures.slice(0, 3)
      : headingFeatures.length >= 1
        ? headingFeatures.slice(0, 3)
        : [] // 没有真实数据则不展示功能卡片

  // logo 墙 / 定价：采集到的结构化内容块，供 HTML 原生重绘镜头(logo-wall / pricing)
  // 过滤规则：去掉 "Image N" 等 alt-text 占位、太短/太长、不像品牌名的文本
  const logos = dedupe(c?.logos || [])
    .filter((l) => {
      if (l.length < 2 || l.length > 30) return false
      // 过滤掉 "Image 1", "Image 2" 等 alt-text 占位
      if (/^image\s*\d+$/i.test(l)) return false
      // 过滤掉纯数字或纯符号
      if (/^[\d\s!@#$%^&*()+=\-\[\]{}|\\/:;"'<>,.?/~`]+$/i.test(l)) return false
      // 只保留看起来像品牌名的文本（包含大写字母、中文字符、或至少一个字母）
      if (/[A-Z]/.test(l) || /[\u4e00-\u9fff]/.test(l) || /[a-z]/.test(l)) return true
      return false
    })
    .slice(0, 8)
  const pricing: PricingTier[] = (c?.pricing || [])
    .filter((p) => p.name && p.price)
    .slice(0, 4)
    .map((p) => ({ name: p.name.slice(0, 24), price: p.price.slice(0, 16) }))

  // CTA
  const ctaHeadline = ctas[0] ? `${ctas[0]}.` : "Get started."
  const command = (tokens?.ctas?.[0]?.href || "").replace(/^https?:\/\//, "").slice(0, 48)

  // 截图：用满已采集截图（最多 8 张，实际入选镜头数在 selectStoryboard 里限量）。
  //   字幕换源——只用页面真实卖点(h2/h3/标签)派生短句；asset 描述仅供内部参考，
  //   绝不进字幕（避免 "补充截图 N — marketing" 内部标签 / "A documentation page…" 泛描述）。
  void descs
  const captionPool = buildCaptionPool(visible, chips)
  const captionFallback = (i: number): string =>
    [`${title} in action`, "See it in action", "A closer look", `Inside ${title}`][i % 4]!
  const shots: ShotMaterial[] = assetPaths.slice(0, 8).map((src, i) => ({
    src,
    caption: captionPool[i % captionPool.length] || captionFallback(i),
    tall: true,
  }))

  // 从可见文本 / 结构化内容里取真实统计数字：优先采集到的结构化 stats，不足再从可见文本
  //   兜底提取（无 / 不足 2 条则不会出现 data-counter 镜头，两条路径都绝不编造）
  const contentStats = (c?.stats || []).filter((s) => s.value && s.label)
  const stats = contentStats.length >= 2 ? contentStats.slice(0, 3) : extractStats(visible)

  // 域名 seed：优先用 meta.id(= 采集时按 URL 主机名派生的 slug)，保证同站稳定、异站不同
  const seedKey = meta.id || title || name

  // 视觉系统(皮肤)：按调性(文案+配色+字体) + seed 选一套 → 异站分化到"皮肤"层，不只镜头顺序
  const accentSat = saturation(palette.accent)
  const toneText = [
    title,
    tagline,
    headline,
    lede,
    ...chips,
    ...valueProps.map((v) => `${v!.title} ${v!.desc}`),
    ...ctas,
  ].join(" ")
  const skin = selectVisualSystem(
    { text: toneText, accentSat, accentNeutral: accentSat < 0.15, monoFont: /mono/i.test(palette.fontFamily) },
    hashSeed(seedKey)
  )

  const entries = selectStoryboard(
    { seedKey, shots, stats, chips: chips.length, valueProps: valueProps.length, logos: logos.length, pricing: pricing.length },
    durationSec,
    skin
  )
  const scenes = layoutScenes(entries, durationSec, skin.minShot)

  // 品牌动效预设：从品牌名/域名推导调性 → 推导动效参数
  const brandProfile = detectBrandProfile(`${name} ${seedKey}`)
  const motionProfile = deriveMotionProfile(brandProfile.tone, brandProfile.energy)

  return {
    id: meta.id || "video",
    name,
    brand: { title, tagline },
    hero: { headline, lede, ctas, chips },
    valueProps,
    logos,
    pricing,
    cta: { headline: ctaHeadline, command },
    palette,
    skin,
    motionProfile,
    scenes,
    durationSec,
  }
}
