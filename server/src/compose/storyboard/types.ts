import type { ChapterId } from "../chapters/types"
import type { ShotType } from "../model"

/** HyperFrames transition types for frame entry */
export type TransitionType =
  | "cut"
  | "crossfade"
  | "blur-crossfade"
  | "push-slide"
  | "zoom-through"
  | "squeeze"

export interface Storyboard {
  meta: StoryboardMeta
  shots: StoryboardShot[]
  /** Global storyboard metadata (HyperFrames STORYBOARD.md format) */
  globals?: {
    format?: string
    message?: string
    arc?: string
    audience?: string
  }
}

export interface StoryboardMeta {
  brand: string
  tagline: string
  tone: string
  totalDuration: number
  skin: string
  fontFamily: string
  palette: {
    fg: string; bg: string; accent: string; accentFg: string
    muted: string; secondary: string; border: string
  }
}

export interface StoryboardShot {
  id: string
  type: ShotType
  chapter: ChapterId
  startTime: number
  duration: number
  visualDescription: string
  screenText?: {
    headline?: string
    subheadline?: string
    eyebrow?: string
    labels?: string[]
    data?: Array<{ value: string; label: string }>
    command?: string
  }
  narration?: string
  transition: "crossfade" | "flash" | "cut" | "wipe" | "slide-left" | "zoom-in"
  assets?: string[]
  cameraMotion?: string
  layers?: {
    background?: LayerSpec
    midground?: LayerSpec
    foreground?: LayerSpec
  }
  choreography?: {
    enterEase: string
    stagger: number
    exitDelay: number
  }

  // ── HyperFrames STORYBOARD.md fields (all optional, backward-compatible) ──

  /** Transition type for entering this frame */
  transition_in?: TransitionType
  /** Contact-sheet thumbnail seek position (seconds) */
  poster?: number
  /** Asset candidates selected from asset-descriptions.md */
  asset_candidates?: string[]
  /** Animation blueprint ID */
  blueprint?: string
  /** Focal element description */
  focal?: string
  /** Element roles mapping */
  roles?: Record<string, string>
  /** Sound effect hint */
  sfx?: string
  /** Frame production status */
  status?: "outline" | "built" | "animated"
  /** Frame HTML source file path */
  src?: string
  /** Voiceover narration text */
  voiceover?: string
}

export interface LayerSpec {
  type: "gradient" | "grid" | "particles" | "glow" | "scanline" | "geometric" | "none"
  color?: string
  animationHint?: string
  opacity?: number
}
