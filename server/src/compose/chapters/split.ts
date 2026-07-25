// Split a VideoModel's scenes array into 5 chapter plans.
// Each scene is assigned to exactly one chapter based on its shot type prefix.
import type { VideoModel, Scene, ShotType } from "../model"
import type { ChapterId, ChapterPlan } from "./types"

/** Map a shot type to its chapter ID */
function shotToChapter(kind: ShotType): ChapterId {
  if (kind === "brand-center" || kind === "brand-side") return "ch1-opening"
  if (kind === "hero-split" || kind === "hero-stack") return "ch2-hero"
  if (kind === "shot-window" || kind === "shot-tilt" || kind === "shot-zoom" || kind === "shot-split") return "ch3-showcase"
  if (
    kind === "feature-row" || kind === "feature-stack" ||
    kind === "data-counter" || kind === "chips-marquee" ||
    kind === "logo-wall" || kind === "pricing"
  ) return "ch4-proof"
  // cta-push, cta-fullbleed
  return "ch5-cta"
}

const CHAPTER_META: Record<ChapterId, { title: string }> = {
  "ch1-opening":  { title: "Opening" },
  "ch2-hero":     { title: "Hero" },
  "ch3-showcase": { title: "Showcase" },
  "ch4-proof":    { title: "Proof" },
  "ch5-cta":      { title: "Call to Action" },
}

const ALL_CHAPTER_IDS: ChapterId[] = [
  "ch1-opening", "ch2-hero", "ch3-showcase", "ch4-proof", "ch5-cta",
]

/**
 * Split a VideoModel's scenes into 5 chapter plans.
 *
 * Timing is computed from the actual scene start/duration values:
 * each chapter's startSec = earliest scene start in that chapter,
 * each chapter's durationSec = sum of its scenes' durations.
 *
 * Chapters with no scenes get 0 duration and are still included
 * (the root HTML will skip them gracefully).
 */
export function splitScenesToChapters(model: VideoModel): ChapterPlan[] {
  // Group scenes by chapter
  const groups = new Map<ChapterId, Scene[]>()
  for (const id of ALL_CHAPTER_IDS) groups.set(id, [])

  for (const scene of model.scenes) {
    const chId = shotToChapter(scene.kind)
    groups.get(chId)!.push(scene)
  }

  // Compute timing per chapter
  const plans: ChapterPlan[] = []

  for (const id of ALL_CHAPTER_IDS) {
    const scenes = groups.get(id)!
    const meta = CHAPTER_META[id]

    if (scenes.length === 0) {
      plans.push({
        id,
        title: meta.title,
        startSec: 0,
        durationSec: 0,
        shotTypes: [],
        assets: [],
      })
      continue
    }

    const startSec = Math.min(...scenes.map((s) => s.start))
    const durationSec = scenes.reduce((sum, s) => sum + s.duration, 0)
    const shotTypes = scenes.map((s) => s.kind)

    // Collect screenshot assets (only ch3-showcase uses them)
    const assets: string[] = []
    if (id === "ch3-showcase") {
      for (const scene of scenes) {
        for (const shot of scene.shots || []) {
          if (shot.src) assets.push(shot.src)
        }
      }
    }

    plans.push({ id, title: meta.title, startSec, durationSec, shotTypes, assets })
  }

  // Fix overlaps: if a chapter's end exceeds the next chapter's start, shrink it
  for (let i = 0; i < plans.length - 1; i++) {
    const curr = plans[i]!
    const next = plans[i + 1]!
    const currEnd = curr.startSec + curr.durationSec
    if (currEnd > next.startSec && next.startSec > curr.startSec) {
      curr.durationSec = next.startSec - curr.startSec
      // Ensure minimum duration
      if (curr.durationSec < 1) curr.durationSec = 1
    }
  }

  return plans
}
