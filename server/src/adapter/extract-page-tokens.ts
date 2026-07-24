/// <reference lib="dom" />
// 浏览器侧品牌数据提取。
// 这是本文档 → 适配器落地之间【唯一需要动 Agent 源码】的部分（PRD §5「小改动」）：
// M3 时在 Firenze playwright-driver 的 snapshot() 里加一行
//   const pageTokens = await page.evaluate(extractPageTokensInBrowser)
// 即可为 tokens.json 提供品牌色/字体/CSS 变量。
//
// 本函数在【浏览器上下文】执行，因此：不能引用任何 Node/外部变量，必须自包含、返回可序列化对象。
import type { PageContent, PageTokens } from "./types"

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

  // === 结构化内容块：多读一层 DOM（成本低、不加渲染时间），供 compose 层原生重绘为主体 ===
  const clean = (s: string | null | undefined): string => (s || "").replace(/\s+/g, " ").trim()

  // features：遍历 h2/h3 标题，就近取描述段落配成 {title, desc}
  const features: Array<{ title: string; desc: string }> = []
  {
    const seen = new Set<string>()
    for (const h of Array.from(document.querySelectorAll("h2, h3")).slice(0, 60)) {
      const title = clean((h as HTMLElement).innerText).slice(0, 48)
      if (title.length < 3 || seen.has(title.toLowerCase())) continue
      let desc = ""
      const sib = h.nextElementSibling
      if (sib && sib.tagName === "P") desc = clean((sib as HTMLElement).innerText)
      if (!desc) {
        const p = h.parentElement?.querySelector("p")
        if (p) desc = clean((p as HTMLElement).innerText)
      }
      desc = desc.slice(0, 200)
      if (desc.length < 20) continue
      seen.add(title.toLowerCase())
      features.push({ title, desc })
      if (features.length >= 6) break
    }
  }

  // logos：trusted-by / customers / partners 容器里收集品牌名
  const logos: string[] = []
  {
    const seen = new Set<string>()
    const kw = /(trusted|customer|partner|used by|powered by|backed by|companies|brands|logos?)/i
    const containers = Array.from(
      document.querySelectorAll(
        "section, header, footer, [class*='logo'], [class*='trusted'], [class*='customer'], [class*='partner'], [class*='brand']"
      )
    ).slice(0, 80)
    for (const c of containers) {
      const hint = (c.getAttribute("class") || "") + " " + clean((c as HTMLElement).innerText).slice(0, 120)
      if (!kw.test(hint)) continue
      for (const el of Array.from(c.querySelectorAll("img[alt], svg[aria-label], svg title"))) {
        const tag = el.tagName.toLowerCase()
        let name = tag === "img" ? el.getAttribute("alt") || "" : tag === "svg" ? el.getAttribute("aria-label") || "" : el.textContent || ""
        name = clean(name).replace(/\s*(logo|icon)\s*$/i, "").trim()
        if (name.length < 2 || name.length > 24) continue
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        logos.push(name)
      }
      if (logos.length >= 8) break
    }
  }

  // pricing：pricing/plan/tier 卡片里匹配套餐名 + 价格
  const pricing: Array<{ name: string; price: string }> = []
  {
    const seen = new Set<string>()
    const priceRe = /(\$|\u20ac|\u00a3|\u00a5)\s?\d[\d.,]*|\bfree\b/i
    const cards = Array.from(
      document.querySelectorAll("[class*='pricing'] [class*='card'], [class*='plan'], [class*='tier'], [class*='price']")
    ).slice(0, 40)
    for (const card of cards) {
      const pm = clean((card as HTMLElement).innerText).match(priceRe)
      if (!pm) continue
      const nameEl = card.querySelector("h2, h3, h4, strong, [class*='name'], [class*='title']")
      const name = clean(nameEl ? (nameEl as HTMLElement).innerText : "").slice(0, 32)
      if (name.length < 2) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      pricing.push({ name, price: clean(pm[0]) })
      if (pricing.length >= 4) break
    }
  }

  // sections：h2 文本作分区标题
  const sectionTitles: string[] = []
  {
    const seen = new Set<string>()
    for (const h of Array.from(document.querySelectorAll("h2"))) {
      const t = clean((h as HTMLElement).innerText)
      if (t.length < 3 || t.length > 48 || seen.has(t.toLowerCase())) continue
      seen.add(t.toLowerCase())
      sectionTitles.push(t)
      if (sectionTitles.length >= 8) break
    }
  }

  // stats：大数字 + 相邻标签
  const stats: Array<{ value: string; label: string }> = []
  {
    const seen = new Set<string>()
    const numRe = /^\s*(\d[\d.,]*)\s*(%|x|K|M|B|\+|k|m|bn|million|billion)?\s*$/
    const cands = Array.from(
      document.querySelectorAll("h1, h2, h3, strong, b, [class*='stat'], [class*='metric'], [class*='number']")
    ).slice(0, 120)
    for (const el of cands) {
      const value = clean((el as HTMLElement).innerText)
      if (!numRe.test(value) || seen.has(value)) continue
      let label = ""
      const sib = el.nextElementSibling
      if (sib) label = clean((sib as HTMLElement).innerText)
      if (!label && el.parentElement) {
        label = clean(el.parentElement.innerText).replace(value, " ").replace(/\s+/g, " ").trim()
      }
      label = label.split(/[.,;:\u2014-]/)[0].trim().slice(0, 24)
      if (label.length < 2) continue
      seen.add(value)
      stats.push({ value, label })
      if (stats.length >= 4) break
    }
  }

  const content: PageContent = {}
  if (features.length) content.features = features
  if (logos.length >= 3) content.logos = logos
  if (pricing.length) content.pricing = pricing
  if (sectionTitles.length) content.sections = sectionTitles
  if (stats.length) content.stats = stats

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
    ...(Object.keys(content).length ? { content } : {}),
    page: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    },
  }
}
