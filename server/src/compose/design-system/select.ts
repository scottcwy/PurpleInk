// Preset selection algorithm: matches brand tokens to the best frame preset.
// Uses color analysis (saturation/lightness), industry keyword matching,
// and domain hashing for deterministic tiebreaking.
import type { FramePreset, BrandTokens } from "./types.js"
import { FRAME_PRESETS } from "./presets.js"

/**
 * Select the best frame preset based on brand tokens.
 *
 * Algorithm:
 * 1. Analyze brand color saturation/lightness → match dark/light preset
 * 2. Industry keywords → match preset tags
 * 3. Domain hash → deterministic tiebreaker (same site always picks same preset)
 */
export function selectPreset(tokens: BrandTokens): FramePreset {
  const scored = FRAME_PRESETS.map((preset) => ({
    preset,
    score: scorePreset(preset, tokens),
  }))

  // Sort by score descending, then by domain hash for deterministic tiebreaking
  scored.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 0.01) return b.score - a.score
    // Tiebreaker: domain hash → deterministic selection
    const hashA = domainHash(`${tokens.domain || ""}:${a.preset.id}`)
    const hashB = domainHash(`${tokens.domain || ""}:${b.preset.id}`)
    return hashA - hashB
  })

  return scored[0]!.preset
}

/** Score a preset against brand tokens (higher = better match) */
function scorePreset(preset: FramePreset, tokens: BrandTokens): number {
  let score = 0

  // 1. Color analysis: saturation and lightness
  if (tokens.colors.length > 0) {
    const avgSat = avgSaturation(tokens.colors)
    const avgLight = avgLightness(tokens.colors)

    // High saturation brands → bold/colorful presets
    if (avgSat > 0.5) {
      if (preset.tags.includes("bold") || preset.tags.includes("colorful")) score += 0.3
      if (preset.tags.includes("poster")) score += 0.2
    }
    // Low saturation brands → restrained/editorial presets
    if (avgSat < 0.2) {
      if (preset.tags.includes("editorial") || preset.tags.includes("minimal")) score += 0.3
      if (preset.tags.includes("restrained")) score += 0.2
    }
    // Dark brands → dark presets
    if (avgLight < 0.3) {
      if (preset.tags.includes("dark") || preset.tags.includes("industrial")) score += 0.3
    }
    // Light brands → light presets
    if (avgLight > 0.7) {
      if (preset.tags.includes("light")) score += 0.2
    }
  }

  // 2. Industry / domain keyword → tag matching
  const keywords = `${tokens.industry || ""} ${tokens.domain || ""} ${tokens.title} ${tokens.description}`.toLowerCase()
  const tagMatches = countTagMatches(preset.tags, keywords)
  score += tagMatches * 0.15

  // 3. Font matching: if brand uses serif fonts, prefer serif presets
  if (tokens.fonts.length > 0) {
    const fontStr = tokens.fonts.join(" ").toLowerCase()
    const isSerif = /serif|garamond|playfair|bodoni|newsreader|baskerville|merriweather/.test(fontStr)
    const isMono = /mono|consolas|jetbrains/.test(fontStr)
    const isSans = /sans|grotesk|inter|archivo|barlow|hanken/.test(fontStr)

    if (isSerif && preset.tags.includes("serif")) score += 0.25
    if (isMono && preset.tags.includes("technical")) score += 0.2
    if (isSans && !preset.tags.includes("serif")) score += 0.15
  }

  return score
}

/** Count how many preset tags appear in the keyword text */
function countTagMatches(tags: string[], keywords: string): number {
  let count = 0
  for (const tag of tags) {
    if (keywords.includes(tag)) count++
  }
  return count
}

/** Calculate average saturation (0-1) of an array of hex colors */
function avgSaturation(colors: string[]): number {
  if (colors.length === 0) return 0
  let sum = 0
  for (const hex of colors) {
    const [, s] = hexToHsl(hex)
    sum += s
  }
  return sum / colors.length
}

/** Calculate average lightness (0-1) of an array of hex colors */
function avgLightness(colors: string[]): number {
  if (colors.length === 0) return 0.5
  let sum = 0
  for (const hex of colors) {
    const [, , l] = hexToHsl(hex)
    sum += l
  }
  return sum / colors.length
}

/** Convert hex color to HSL [h: 0-360, s: 0-1, l: 0-1] */
function hexToHsl(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "")
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2

  if (max === min) return [0, 0, l]

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

  let hue = 0
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) hue = ((b - r) / d + 2) / 6
  else hue = ((r - g) / d + 4) / 6

  return [hue * 360, s, l]
}

/** FNV-1a hash → 0-1 float for deterministic tiebreaking */
function domainHash(domain: string): number {
  let hash = 2166136261 >>> 0
  for (let i = 0; i < domain.length; i++) {
    hash ^= domain.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967296
}
