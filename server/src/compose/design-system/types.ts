// Design system types: Frame presets, brand tokens, and frame specs.
// Replaces the hard-coded 3-skin VisualSystem with a richer preset library
// sourced from HyperFrames frame-presets.

/** A frame preset's color roles */
export interface PresetPalette {
  /** Primary text / ink color */
  ink: string
  /** Background / canvas color */
  canvas: string
  /** Accent colors (2-4) */
  accents: string[]
  /** Secondary / muted text color */
  muted: string
}

/** Type ramp: the font stack for a preset */
export interface TypeRamp {
  /** Display / hero font */
  display: string
  /** Heading font */
  heading: string
  /** Body font */
  body: string
  /** Monospace font */
  mono: string
  /** Font size scale in rem */
  scale: number[]
}

/** A complete HyperFrames frame preset */
export interface FramePreset {
  /** e.g. "cobalt-grid" */
  id: string
  /** e.g. "Cobalt Grid" */
  name: string
  palette: PresetPalette
  typeRamp: TypeRamp
  /** Style tags for matching, e.g. ["bold", "tech", "dark"] */
  tags: string[]
  /** Caption skin HTML snippet (from caption-skin.html) */
  captionSkin?: string
  /** Composition rules describing the preset's visual language */
  compositionRules: string[]
}

/** Brand tokens extracted from capture */
export interface BrandTokens {
  title: string
  description: string
  /** Extracted brand color hex values */
  colors: string[]
  /** Extracted font family names */
  fonts: string[]
  /** Industry keyword */
  industry?: string
  /** Domain name */
  domain?: string
}

/** Output of buildFrame: a fully resolved frame spec ready for rendering */
export interface FrameSpec {
  preset: FramePreset
  /** Final mapped palette after brand color integration */
  palette: PresetPalette
  /** Final mapped type ramp after brand font integration */
  typeRamp: TypeRamp
  /** frame.md markdown content */
  markdown: string
  /** caption-skin.html content */
  captionSkin?: string
}
