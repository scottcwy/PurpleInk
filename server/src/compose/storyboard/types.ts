import type { ChapterId } from "../chapters/types"
import type { ShotType } from "../model"

export interface Storyboard {
  meta: StoryboardMeta
  shots: StoryboardShot[]
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
}

export interface LayerSpec {
  type: "gradient" | "grid" | "particles" | "glow" | "scanline" | "geometric" | "none"
  color?: string
  animationHint?: string
  opacity?: number
}
