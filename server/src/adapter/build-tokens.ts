// PageTokens → tokens.json（对齐 _capture_probe 金样本结构）。
// tokens.json 是 HyperFrames Step2（build-frame）读取的品牌来源；
// 下限字段 {title, description, colors, fonts} 必须有，其余尽量补齐以贴品牌。
import type { PageTokens } from "./types"

/** 从可见文本兜底提取一个描述（当 pageTokens.description 缺失时） */
function fallbackDescription(pageTokens: PageTokens): string {
  const firstHeadingBody = pageTokens.headings?.[0]?.text
  return pageTokens.description || firstHeadingBody || ""
}

/**
 * 组装 tokens.json 对象。
 * 只输出「有数据」的字段，避免写一堆空数组污染下游判断。
 */
export function buildTokens(pageTokens: PageTokens): Record<string, unknown> {
  const tokens: Record<string, unknown> = {
    title: pageTokens.title || "",
    description: fallbackDescription(pageTokens),
  }

  if (pageTokens.ogImage) tokens.ogImage = pageTokens.ogImage
  if (pageTokens.cssVariables && Object.keys(pageTokens.cssVariables).length > 0) {
    tokens.cssVariables = pageTokens.cssVariables
  }

  // fonts：下限空数组也保留（下游会 fallback 到系统字体），但优先给真实字体
  tokens.fonts = (pageTokens.fonts ?? []).map((f) => {
    const entry: Record<string, unknown> = { family: f.family, weights: f.weights ?? [] }
    if (typeof f.variable === "boolean") entry.variable = f.variable
    if (f.weightRange) entry.weightRange = f.weightRange
    return entry
  })

  // colors：去重 + 统一大写，保留出现顺序
  tokens.colors = dedupeUpper(pageTokens.colors ?? [])

  if (pageTokens.headings && pageTokens.headings.length > 0) tokens.headings = pageTokens.headings
  if (pageTokens.ctas && pageTokens.ctas.length > 0) tokens.ctas = pageTokens.ctas
  if (pageTokens.colorStats && pageTokens.colorStats.length > 0) {
    tokens.colorStats = pageTokens.colorStats
  }
  if (pageTokens.sections && pageTokens.sections.length > 0) tokens.sections = pageTokens.sections
  if (pageTokens.page) tokens.page = pageTokens.page

  return tokens
}

/** 十六进制颜色去重（大写规范化），保留首次出现顺序 */
function dedupeUpper(colors: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of colors) {
    const c = raw.trim().toUpperCase()
    if (!c || seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
}

/** 序列化为带缩进的 JSON 文本（与官方一致：2 空格缩进） */
export function serializeTokens(pageTokens: PageTokens): string {
  return JSON.stringify(buildTokens(pageTokens), null, 2) + "\n"
}
