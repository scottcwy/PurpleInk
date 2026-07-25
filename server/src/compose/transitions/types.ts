// Transition types for frame-to-frame animation injection.
// Aligns with HyperFrames transition system.

/** Supported transition types */
export type TransitionType =
  | "cut"
  | "crossfade"
  | "blur-crossfade"
  | "push-slide"
  | "zoom-through"
  | "squeeze"

/** Transition direction */
export type TransitionDirection = "left" | "right" | "up" | "down"

/** Single transition configuration */
export interface TransitionConfig {
  type: TransitionType
  direction?: TransitionDirection // default: 'left'
  duration?: number // transition duration in seconds, default: 0.6
}

/** Transition injection parameters */
export interface TransitionInjectParams {
  shots: Array<{ id: string; duration: number; transitionIn?: TransitionConfig }>
  totalDuration: number
}

/** Transition injection result */
export interface TransitionInjectResult {
  /** GSAP transition animation code to inject into index.html */
  gsapCode: string
  /** Adjusted frame durations (transitions require overlap) */
  adjustedDurations: Map<string, number>
  /** Track index assignment for ping-pong (adjacent frames don't share track) */
  trackIndices: Map<string, number>
}
