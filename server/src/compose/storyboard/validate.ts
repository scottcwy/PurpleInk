// Storyboard validation: checks structural integrity and business rules.
import type { Storyboard, TransitionType } from "./types"

/** Valid transition_in values */
const VALID_TRANSITIONS: TransitionType[] = [
  "cut", "crossfade", "blur-crossfade", "push-slide", "zoom-through", "squeeze",
]

/** Valid status values */
const VALID_STATUSES = ["outline", "built", "animated"] as const

/**
 * Validate a storyboard for structural correctness and business rules.
 * Returns an array of error messages (empty = valid).
 */
export function validateStoryboard(sb: Storyboard): string[] {
  const errors: string[] = []

  if (!sb.shots || sb.shots.length === 0) {
    errors.push("No shots defined")
    return errors
  }

  if (sb.shots.length < 3) {
    errors.push(`Too few shots: ${sb.shots.length} (min 3)`)
  }

  // Check first shot is brand type
  const firstShot = sb.shots[0]!
  if (firstShot.type !== "brand-center" && firstShot.type !== "brand-side") {
    errors.push(`First shot should be brand-center or brand-side, got: ${firstShot.type}`)
  }

  // Check last shot is CTA type
  const lastShot = sb.shots[sb.shots.length - 1]!
  if (lastShot.type !== "cta-push" && lastShot.type !== "cta-fullbleed") {
    errors.push(`Last shot should be cta-push or cta-fullbleed, got: ${lastShot.type}`)
  }

  let currentTime = 0
  for (const shot of sb.shots) {
    // Required fields
    if (!shot.id) errors.push("Shot missing id")
    if (!shot.type) errors.push(`Shot ${shot.id || "?"}: missing type`)
    if (!shot.chapter) errors.push(`Shot ${shot.id || "?"}: missing chapter`)
    if (!shot.duration || shot.duration < 2) {
      errors.push(`Shot ${shot.id || "?"}: duration too short (${shot.duration}s, min 2s)`)
    }
    if (!shot.visualDescription) {
      errors.push(`Shot ${shot.id || "?"}: missing visualDescription`)
    }

    // Narration validation
    if (!shot.narration) {
      errors.push(`Shot ${shot.id || "?"}: missing narration`)
    } else {
      const wordCount = shot.narration.trim().split(/\s+/).length
      if (wordCount > 18) {
        errors.push(`Shot ${shot.id || "?"}: narration too long (${wordCount} words, max 18)`)
      }
    }

    // Time continuity
    if (shot.startTime < currentTime - 0.5) {
      errors.push(`Shot ${shot.id || "?"}: startTime ${shot.startTime} overlaps with previous (expected >= ${currentTime})`)
    }
    currentTime = shot.startTime + (shot.duration || 0)

    // ── New field validation (warnings, not errors) ──

    // transition_in must be a valid TransitionType
    if (shot.transition_in !== undefined && !VALID_TRANSITIONS.includes(shot.transition_in)) {
      errors.push(`[warn] Shot ${shot.id || "?"}: invalid transition_in "${shot.transition_in}" (valid: ${VALID_TRANSITIONS.join(", ")})`)
    }

    // poster must be >= 0
    if (shot.poster !== undefined && shot.poster < 0) {
      errors.push(`[warn] Shot ${shot.id || "?"}: poster must be >= 0, got ${shot.poster}`)
    }

    // asset_candidates must be string array
    if (shot.asset_candidates !== undefined) {
      if (!Array.isArray(shot.asset_candidates)) {
        errors.push(`[warn] Shot ${shot.id || "?"}: asset_candidates must be an array`)
      } else if (!shot.asset_candidates.every((a) => typeof a === "string")) {
        errors.push(`[warn] Shot ${shot.id || "?"}: asset_candidates must contain only strings`)
      }
    }

    // status must be valid
    if (shot.status !== undefined && !VALID_STATUSES.includes(shot.status)) {
      errors.push(`[warn] Shot ${shot.id || "?"}: invalid status "${shot.status}" (valid: ${VALID_STATUSES.join(", ")})`)
    }

    // voiceover word count check (same as narration)
    if (shot.voiceover !== undefined) {
      const voWordCount = shot.voiceover.trim().split(/\s+/).length
      if (voWordCount > 18) {
        errors.push(`[warn] Shot ${shot.id || "?"}: voiceover too long (${voWordCount} words, max 18)`)
      }
    }
  }

  // Check total duration matches meta
  if (sb.meta?.totalDuration) {
    const actualEnd = sb.shots.reduce((end, s) => Math.max(end, s.startTime + s.duration), 0)
    const diff = Math.abs(actualEnd - sb.meta.totalDuration)
    if (diff > 1) {
      errors.push(`Total duration mismatch: meta says ${sb.meta.totalDuration}s, shots span ${actualEnd}s (diff: ${diff.toFixed(1)}s)`)
    }
  }

  return errors
}

/**
 * Filter validation results to only hard errors (exclude warnings).
 */
export function getHardErrors(messages: string[]): string[] {
  return messages.filter((m) => !m.startsWith("[warn]"))
}

/**
 * Filter validation results to only warnings.
 */
export function getWarnings(messages: string[]): string[] {
  return messages.filter((m) => m.startsWith("[warn]"))
}
