// Build a FrameSpec by merging a FramePreset with BrandTokens.
// Maps brand colors to preset color roles and brand fonts to preset type ramp,
// then generates the frame.md markdown content.
import type { FramePreset, BrandTokens, FrameSpec, PresetPalette, TypeRamp } from "./types.js"

/**
 * Merge a frame preset with brand tokens to produce a fully resolved FrameSpec.
 *
 * 1. Map brand colors to the preset's color roles (ink/canvas/accents/muted)
 * 2. Map brand fonts to the preset's type ramp (if available)
 * 3. Generate frame.md markdown string
 * 4. Return FrameSpec
 */
export function buildFrame(preset: FramePreset, tokens: BrandTokens): FrameSpec {
  const palette = mapPalette(preset, tokens)
  const typeRamp = mapTypeRamp(preset, tokens)

  const spec: FrameSpec = {
    preset,
    palette,
    typeRamp,
    markdown: "",
  }
  if (preset.captionSkin !== undefined) {
    spec.captionSkin = preset.captionSkin
  }

  spec.markdown = renderFrameMarkdown(spec)
  return spec
}

/**
 * Map brand colors to the preset's color roles.
 * Strategy: keep the preset structure but replace the closest-matching role
 * with the brand's most prominent color.
 */
function mapPalette(preset: FramePreset, tokens: BrandTokens): PresetPalette {
  const brandColors = tokens.colors.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c))
  if (brandColors.length === 0) return { ...preset.palette }

  const palette = { ...preset.palette, accents: [...preset.palette.accents] }

  // Find the most saturated brand color → use as accent replacement
  const bySat = [...brandColors].sort((a, b) => colorSaturation(b) - colorSaturation(a))
  const mostSaturated = bySat[0]!

  // Find the lightest brand color → candidate for canvas
  const byLight = [...brandColors].sort((a, b) => colorLightness(b) - colorLightness(a))
  const lightest = byLight[0]!
  const darkest = byLight[byLight.length - 1]!

  // Replace canvas if the brand's lightest is significantly different
  if (colorDistance(lightest, palette.canvas) > 0.10) {
    palette.canvas = lightest
  }

  // Replace ink if the brand's darkest is significantly different
  if (colorDistance(darkest, palette.ink) > 0.10) {
    palette.ink = darkest
  }

  // Replace the first accent with the most saturated brand color
  if (colorDistance(mostSaturated, palette.accents[0] || palette.ink) > 0.1) {
    palette.accents[0] = mostSaturated
  }

  // Add a second accent if brand has multiple colors
  if (brandColors.length >= 2 && palette.accents.length < 4) {
    const second = bySat.find((c) => colorDistance(c, palette.accents[0]!) > 0.2)
    if (second) palette.accents.push(second)
  }

  return palette
}

/**
 * Map brand fonts to the preset's type ramp.
 * If brand fonts are available, replace the closest matching role.
 */
function mapTypeRamp(preset: FramePreset, tokens: BrandTokens): TypeRamp {
  if (tokens.fonts.length === 0) return { ...preset.typeRamp }

  const ramp = { ...preset.typeRamp }
  const fontNames = tokens.fonts.map((f) => f.toLowerCase())

  // Check for serif fonts → replace display/heading
  const serifFont = fontNames.find((f) =>
    /serif|garamond|playfair|bodoni|newsreader|baskerville|merriweather/.test(f)
  )
  if (serifFont) {
    ramp.display = capitalizeFont(serifFont)
    ramp.heading = capitalizeFont(serifFont)
  }

  // Check for sans-serif fonts → replace body
  const sansFont = fontNames.find((f) =>
    /sans|grotesk|inter|archivo|barlow|hanken|space|quicksand/.test(f)
  )
  if (sansFont) {
    ramp.body = capitalizeFont(sansFont)
  }

  // Check for monospace fonts → replace mono
  const monoFont = fontNames.find((f) =>
    /mono|consolas|jetbrains/.test(f)
  )
  if (monoFont) {
    ramp.mono = capitalizeFont(monoFont)
  }

  return ramp
}

/** Capitalize a font name for CSS output */
function capitalizeFont(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

/** Generate the frame.md markdown content from a FrameSpec */
function renderFrameMarkdown(spec: FrameSpec): string {
  const { palette, typeRamp, preset } = spec

  const lines: string[] = [
    "---",
    `frame: ${preset.id}`,
    `name: ${preset.name}`,
    "",
    "palette:",
    `  ink: "${palette.ink}"`,
    `  canvas: "${palette.canvas}"`,
    `  muted: "${palette.muted}"`,
    "  accents:",
    ...palette.accents.map((a) => `    - "${a}"`),
    "",
    "typography:",
    `  display: "${typeRamp.display}"`,
    `  heading: "${typeRamp.heading}"`,
    `  body: "${typeRamp.body}"`,
    `  mono: "${typeRamp.mono}"`,
    `  scale: [${typeRamp.scale.join(", ")}]`,
    "",
    "composition:",
    ...preset.compositionRules.map((r) => `  - ${r}`),
    "---",
  ]

  return lines.join("\n")
}

// ---------- Color utility functions ----------

/** Calculate color saturation (0-1) from hex */
function colorSaturation(hex: string): number {
  const [, s] = hexToHsl(hex)
  return s
}

/** Calculate color lightness (0-1) from hex */
function colorLightness(hex: string): number {
  const [, , l] = hexToHsl(hex)
  return l
}

/** Simple perceptual distance between two hex colors (0-1) */
function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  // Weighted Euclidean distance (redmean approximation)
  const rMean = (r1 + r2) / 2
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  const dist = Math.sqrt(
    (2 + rMean / 256) * dr * dr +
    4 * dg * dg +
    (2 + (255 - rMean) / 256) * db * db
  )
  // Normalize to 0-1 range (max ~765)
  return Math.min(1, dist / 765)
}

/** Convert hex to RGB tuple */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "")
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/** Convert hex to HSL [h: 0-360, s: 0-1, l: 0-1] */
function hexToHsl(hex: string): [number, number, number] {
  const [r255, g255, b255] = hexToRgb(hex)
  const r = r255 / 255
  const g = g255 / 255
  const b = b255 / 255
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
