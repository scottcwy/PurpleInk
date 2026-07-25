// Transition injection core logic.
// Computes transition parameters, generates GSAP code, and assigns track indices.
// Aligns with HyperFrames transitions.mjs inject behavior.
import type { TransitionInjectParams, TransitionInjectResult } from "./types.js"
import { generateTransitionGsap } from "./gsap-templates.js"

/**
 * Compute transition injection parameters.
 *
 * Core logic (aligned with HyperFrames transitions.mjs inject):
 * 1. Only extend outgoing frame's data-duration (keeps voice/SFX/captions in sync)
 * 2. 0/1 ping-pong all frame clip data-track-index (adjacent frames don't share track)
 * 3. Generate GSAP code for each transition
 */
export function injectTransitions(params: TransitionInjectParams): TransitionInjectResult {
  const adjustedDurations = new Map<string, number>()
  const trackIndices = new Map<string, number>()
  let gsapCode = ""

  let currentTime = 0

  for (let i = 0; i < params.shots.length; i++) {
    const shot = params.shots[i]!
    const transition = shot.transitionIn

    // Ping-pong track index (0/1)
    trackIndices.set(shot.id, i % 2)

    if (i > 0 && transition && transition.type !== "cut") {
      const prevShot = params.shots[i - 1]!
      const duration = transition.duration ?? 0.6

      // Extend previous frame's duration to create overlap
      const prevAdjusted = adjustedDurations.get(prevShot.id) ?? prevShot.duration
      adjustedDurations.set(prevShot.id, prevAdjusted + duration)

      // Generate transition GSAP code
      gsapCode += generateTransitionGsap(
        prevShot.id,
        shot.id,
        transition,
        currentTime + (prevShot.duration - duration),
      )
    }

    if (!adjustedDurations.has(shot.id)) {
      adjustedDurations.set(shot.id, shot.duration)
    }
    currentTime += shot.duration
  }

  return { gsapCode, adjustedDurations, trackIndices }
}
