// Storyboard validation: checks structural integrity and business rules.
import type { Storyboard } from "./types"

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
