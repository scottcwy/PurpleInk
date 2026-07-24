// Sub-composition chapter types for the 5-chapter architecture.
// Each chapter = an independent HTML file referenced by the root index.html.
import type { ShotType, VisualSystem } from "../model"

/** The five canonical chapter IDs */
export type ChapterId =
  | "ch1-opening"
  | "ch2-hero"
  | "ch3-showcase"
  | "ch4-proof"
  | "ch5-cta"

/**
 * A planned chapter: timing + which shot types belong to it.
 * Produced by split.ts from a VideoModel's scenes array.
 */
export interface ChapterPlan {
  id: ChapterId
  title: string
  /** Absolute start time (seconds) on the root timeline */
  startSec: number
  /** Duration (seconds) of this chapter */
  durationSec: number
  /** Shot types assigned to this chapter (maps to template.ts SHOTS) */
  shotTypes: ShotType[]
  /** Screenshot asset paths (only ch3-showcase uses these) */
  assets: string[]
}

/**
 * A rendered chapter: the full sub-composition HTML string.
 * `source` tracks whether it came from the LLM or the template fallback.
 */
export interface ChapterHtml {
  id: ChapterId
  html: string
  source: "llm" | "template"
}

/**
 * ComposeContext: all the brand/copy/visual info needed to generate chapters via LLM.
 * Built from capture directory + VideoModel by buildComposeContext().
 */
export interface ComposeContext {
  brand: { title: string; tagline: string; description: string }
  palette: {
    fg: string; bg: string; accent: string; accentFg: string
    muted: string; secondary: string; border: string
  }
  copy: {
    headline: string; subheadline: string
    ctas: string[]
    features: Array<{ title: string; desc: string }>
    stats: Array<{ value: string; label: string }>
  }
  screenshots: Array<{ path: string; base64Preview: string; caption: string }>
  fontFamily: string
  tone: "bold" | "calm" | "technical"
  durationSec: number
  skin: VisualSystem
  logos: string[]
  pricing: Array<{ name: string; price: string }>
  hero: { headline: string; lede: string; ctas: string[]; chips: string[] }
  cta: { headline: string; command: string }
}
