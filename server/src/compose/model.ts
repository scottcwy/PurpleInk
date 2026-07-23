// 把官方 capture/ 目录解析成一个「视频模型」(VideoModel)。
// 这是方案 B(模板驱动)的第一步：capture/ 的品牌/文案/截图 → 结构化槽位 + 场景时序。
// template.ts 消费本模型生成 index.html；不依赖任何 LLM。
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import type { PageTokens } from "../adapter/types"

/** 场景类型 */
export type SceneKind = "brand" | "hero" | "showcase" | "value" | "cta"

/** 单个场景（含在时间线上的起点/时长，单位秒） */
export interface Scene {
  kind: SceneKind
  start: number
  duration: number
  /** showcase 专用：截图相对路径 + 说明 */
  shot?: { src: string; caption: string; tall: boolean }
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

/** 视频模型：模板渲染所需的一切 */
export interface VideoModel {
  id: string
  name: string
  brand: { title: string; tagline: string }
  hero: { headline: string; lede: string; ctas: string[]; chips: string[] }
  valueProps: Array<{ title: string; desc: string }>
  cta: { headline: string; command: string }
  palette: Palette
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
  v = m[1]
  if (v.length === 3) v = v.split("").map((c) => c + c).join("")
  return "#" + v
}

function rgb(hex: string): [number, number, number] {
  const h = hex.slice(1)
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** 相对亮度（WCAG） */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 对比度（WCAG，1..21） */
function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 饱和度粗估（0..1），用于挑「品牌强调色」 */
function saturation(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => c / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

/** 前景色：在 bg 上对比 >=4.5 的深/浅色 */
function readableOn(bg: string): string {
  return luminance(bg) > 0.5 ? "#0a0a0a" : "#fafafa"
}

/**
 * 从 tokens 派生调色板：优先站点主色，但强制保证对比达 AA，
 * 否则渲染的 check(对比度 gate)会挂。缺色则回落到 shadcn 中性色。
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

  const uniq = Array.from(new Set(hexes))
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
  let accent = varHex("--primary") || ""
  if (!accent) {
    const candidates = uniq
      .filter((h) => saturation(h) > 0.25 && contrast(h, bg) >= 3)
      .sort((a, b) => {
        const ca = countOf.get(a) ?? 0
        const cb = countOf.get(b) ?? 0
        if (cb !== ca) return cb - ca
        return saturation(b) - saturation(a)
      })
    accent = candidates[0] || fg
  }
  if (contrast(accent, bg) < 3) accent = fg
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
    const tag = m[1].toLowerCase()
    const text = m[2].trim()
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
  return title.split(/[|·–—-]/)[0].trim() || title.trim()
}

function dedupe(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => s.trim()).filter(Boolean)))
}

/** 从 asset-descriptions.md 解析 `- path — 描述` */
function parseAssetDescriptions(raw: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^-\s*(\S+)\s*[—-]\s*(.+)$/)
    if (m) map.set(m[1].trim(), m[2].trim())
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

// ---------- 场景时序 ----------

/** 按权重把总时长分配给一组场景 */
function layoutScenes(kinds: Array<{ kind: SceneKind; weight: number; shot?: Scene["shot"] }>, total: number): Scene[] {
  const sum = kinds.reduce((a, k) => a + k.weight, 0) || 1
  const scenes: Scene[] = []
  let cursor = 0
  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i]
    // 最后一个场景吃掉剩余时长，避免累计误差
    const dur = i === kinds.length - 1 ? Math.max(1, total - cursor) : Math.round((k.weight / sum) * total * 10) / 10
    scenes.push({ kind: k.kind, start: Math.round(cursor * 10) / 10, duration: dur, shot: k.shot })
    cursor += dur
  }
  return scenes
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
  const assetPaths = await listAssets(join(captureDir, "assets"))

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

  // 价值卡：优先 h2/h3 作标题；不足则用通用兜底
  const propTitles = dedupe([...visible.h2, ...visible.h3]).filter((t) => t.length <= 28).slice(0, 3)
  const fallbackProps = [
    { title: "Fast", desc: "Built for speed and a smooth experience end to end." },
    { title: "Reliable", desc: "Consistent, production-ready quality every run." },
    { title: "Simple", desc: "Clear, focused, and easy to get started with." },
  ]
  const valueProps = [0, 1, 2].map((i) => {
    const t = propTitles[i]
    if (!t) return fallbackProps[i]
    // 找一段与标题不同的描述文本
    const desc = visible.p.find((p) => p !== t && p.length > 20)?.slice(0, 110) || fallbackProps[i].desc
    return { title: t.slice(0, 24), desc }
  })

  // CTA
  const ctaHeadline = ctas[0] ? `${ctas[0]}.` : "Get started."
  const command = (tokens?.ctas?.[0]?.href || "").replace(/^https?:\/\//, "").slice(0, 48)

  // 截图：最多取 2 张做 showcase 场景
  const shots = assetPaths.slice(0, 2).map((src, i) => ({
    src,
    caption: (descs.get(src) || "").split(/[.。]/)[0].slice(0, 60) || (i === 0 ? "Inside the product." : "More of the experience."),
    tall: true,
  }))

  // 组装场景 + 权重（对齐 shadcn-30s 的节奏感）
  const kinds: Array<{ kind: SceneKind; weight: number; shot?: Scene["shot"] }> = [
    { kind: "brand", weight: 5 },
    { kind: "hero", weight: 8 },
  ]
  if (shots.length > 0) {
    for (const shot of shots) kinds.push({ kind: "showcase", weight: 9, shot })
  }
  kinds.push({ kind: "value", weight: 5.5 })
  kinds.push({ kind: "cta", weight: 2.5 })
  const scenes = layoutScenes(kinds, durationSec)

  return {
    id: meta.id || "video",
    name,
    brand: { title, tagline },
    hero: { headline, lede, ctas, chips },
    valueProps,
    cta: { headline: ctaHeadline, command },
    palette,
    scenes,
    durationSec,
  }
}
