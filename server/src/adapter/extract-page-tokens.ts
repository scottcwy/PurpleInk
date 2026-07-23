/// <reference lib="dom" />
// 浏览器侧品牌数据提取。
// 这是本文档 → 适配器落地之间【唯一需要动 Agent 源码】的部分（PRD §5「小改动」）：
// M3 时在 Firenze playwright-driver 的 snapshot() 里加一行
//   const pageTokens = await page.evaluate(extractPageTokensInBrowser)
// 即可为 tokens.json 提供品牌色/字体/CSS 变量。
//
// 本函数在【浏览器上下文】执行，因此：不能引用任何 Node/外部变量，必须自包含、返回可序列化对象。
import type { PageTokens } from "./types"

/** 在浏览器里执行，提取页面品牌数据。传给 page.evaluate() 使用。 */
export function extractPageTokensInBrowser(): PageTokens {
  const rgbToHex = (rgb: string): string | null => {
    const m = rgb.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const parts = m[1].split(",").map((s) => parseFloat(s.trim()))
    const [r, g, b, a] = parts
    if (a === 0) return null // 完全透明忽略
    const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0")
    return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase()
  }

  const meta = (name: string): string | undefined => {
    const el =
      document.querySelector(`meta[name="${name}"]`) ||
      document.querySelector(`meta[property="${name}"]`)
    return el?.getAttribute("content") || undefined
  }

  // --- CSS 变量：扫描同源样式表的 :root 自定义属性 ---
  const cssVariables: Record<string, string> = {}
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue // 跨域样式表读取会抛错，跳过
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSStyleRule)) continue
        if (!/:root|html/.test(rule.selectorText)) continue
        const style = rule.style
        for (let i = 0; i < style.length; i++) {
          const prop = style[i]
          if (prop.startsWith("--")) cssVariables[prop] = style.getPropertyValue(prop).trim()
        }
      }
    }
  } catch {
    /* ignore */
  }

  // --- 遍历元素：统计颜色角色 + 收集字体 ---
  const colorStatsMap = new Map<
    string,
    { count: number; bgCount: number; textCount: number; maxArea: number }
  >()
  const bump = (hex: string, kind: "bg" | "text", area: number) => {
    const s = colorStatsMap.get(hex) || { count: 0, bgCount: 0, textCount: 0, maxArea: 0 }
    s.count++
    if (kind === "bg") {
      s.bgCount++
      s.maxArea = Math.max(s.maxArea, area)
    } else {
      s.textCount++
    }
    colorStatsMap.set(hex, s)
  }

  const fontFamilies = new Map<string, Set<number>>()
  const nodes = Array.from(document.querySelectorAll("body *")).slice(0, 4000)
  for (const el of nodes) {
    const cs = getComputedStyle(el as Element)
    const rect = (el as HTMLElement).getBoundingClientRect()
    const area = Math.max(0, rect.width) * Math.max(0, rect.height)

    const bg = rgbToHex(cs.backgroundColor)
    if (bg) bump(bg, "bg", area)

    const hasText = !!(el.textContent && el.textContent.trim())
    if (hasText) {
      const color = rgbToHex(cs.color)
      if (color) bump(color, "text", area)
    }

    const fam = (cs.fontFamily || "").split(",")[0]?.replace(/["']/g, "").trim()
    if (fam) {
      const w = parseInt(cs.fontWeight, 10)
      const set = fontFamilies.get(fam) || new Set<number>()
      if (!Number.isNaN(w)) set.add(w)
      fontFamilies.set(fam, set)
    }
  }

  const colorStats = Array.from(colorStatsMap.entries())
    .map(([hex, s]) => ({ hex, ...s }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 24)
  const colors = colorStats.map((c) => c.hex)

  const fonts = Array.from(fontFamilies.entries())
    .slice(0, 8)
    .map(([family, weights]) => ({
      family,
      weights: Array.from(weights).sort((a, b) => a - b),
    }))

  // --- headings ---
  const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
    .slice(0, 12)
    .map((el) => {
      const cs = getComputedStyle(el as Element)
      return {
        level: Number(el.tagName.slice(1)),
        text: (el.textContent || "").replace(/\s+/g, " ").trim(),
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        color: rgbToHex(cs.color) || cs.color,
      }
    })
    .filter((h) => h.text)

  // --- CTA（按钮/链接文案 + href）---
  const ctas = Array.from(document.querySelectorAll("a,button"))
    .map((el) => ({
      text: (el.textContent || "").replace(/\s+/g, " ").trim(),
      href: el.getAttribute("href") || undefined,
    }))
    .filter((c) => c.text)
    .slice(0, 24)

  return {
    title: document.title || "",
    description: meta("description"),
    ogImage: meta("og:image"),
    colors,
    fonts,
    cssVariables,
    headings,
    ctas,
    colorStats,
    page: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    },
  }
}
