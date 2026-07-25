// GSAP animation template generators for each transition type.
// Each template produces a self-contained GSAP timeline snippet
// that gets injected into the root index.html <script>.
import type { TransitionConfig, TransitionDirection } from "./types.js"

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Generate GSAP animation code for a specific transition.
 * Output is pure JS code string injected into index.html <script>.
 *
 * Each transition is a GSAP timeline registered to window.__timelines["main"].
 * Transitions act between outgoing frame (leaving) and incoming frame (entering).
 */
export function generateTransitionGsap(
  outgoingId: string,
  incomingId: string,
  config: TransitionConfig,
  startTime: number,
): string {
  switch (config.type) {
    case "cut":
      return "" // cut requires no animation
    case "crossfade":
      return crossfadeTemplate(outgoingId, incomingId, config, startTime)
    case "blur-crossfade":
      return blurCrossfadeTemplate(outgoingId, incomingId, config, startTime)
    case "push-slide":
      return pushSlideTemplate(outgoingId, incomingId, config, startTime)
    case "zoom-through":
      return zoomThroughTemplate(outgoingId, incomingId, config, startTime)
    case "squeeze":
      return squeezeTemplate(outgoingId, incomingId, config, startTime)
    default:
      return ""
  }
}

/** Build direction-based translate values */
function directionTranslate(dir: TransitionDirection): { x: string; y: string } {
  switch (dir) {
    case "left":
      return { x: "-100%", y: "0%" }
    case "right":
      return { x: "100%", y: "0%" }
    case "up":
      return { x: "0%", y: "-100%" }
    case "down":
      return { x: "0%", y: "100%" }
    default:
      return { x: "-100%", y: "0%" }
  }
}

/** crossfade: outgoing opacity 1→0, incoming opacity 0→1 */
function crossfadeTemplate(
  outgoingId: string,
  incomingId: string,
  config: TransitionConfig,
  startTime: number,
): string {
  const dur = round(config.duration ?? 0.6)
  const t = round(startTime)
  return `
(function() {
  var tl = gsap.timeline({ paused: true });
  tl.to("#${outgoingId}", { opacity: 0, duration: ${dur}, ease: "power2.inOut" }, ${t});
  tl.fromTo("#${incomingId}", { opacity: 0 }, { opacity: 1, duration: ${dur}, ease: "power2.inOut" }, ${t});
  window.__timelines["main"].add(tl, 0);
})();`.trim() + "\n"
}

/** blur-crossfade: crossfade + filter blur(0→10px) and blur(10px→0) */
function blurCrossfadeTemplate(
  outgoingId: string,
  incomingId: string,
  config: TransitionConfig,
  startTime: number,
): string {
  const dur = round(config.duration ?? 0.6)
  const t = round(startTime)
  return `
(function() {
  var tl = gsap.timeline({ paused: true });
  tl.to("#${outgoingId}", { opacity: 0, filter: "blur(10px)", duration: ${dur}, ease: "power2.inOut" }, ${t});
  tl.fromTo("#${incomingId}", { opacity: 0, filter: "blur(10px)" }, { opacity: 1, filter: "blur(0px)", duration: ${dur}, ease: "power2.inOut" }, ${t});
  window.__timelines["main"].add(tl, 0);
})();`.trim() + "\n"
}

/** push-slide: outgoing translateX(0→-100%), incoming translateX(100%→0) */
function pushSlideTemplate(
  outgoingId: string,
  incomingId: string,
  config: TransitionConfig,
  startTime: number,
): string {
  const dur = round(config.duration ?? 0.6)
  const dir = config.direction ?? "left"
  const t = round(startTime)
  const trans = directionTranslate(dir)
  const outX = trans.x
  const outY = trans.y
  // Incoming comes from opposite direction
  const inX = dir === "left" ? "100%" : dir === "right" ? "-100%" : "0%"
  const inY = dir === "up" ? "100%" : dir === "down" ? "-100%" : "0%"

  return `
(function() {
  var tl = gsap.timeline({ paused: true });
  tl.to("#${outgoingId}", { x: "${outX}", y: "${outY}", duration: ${dur}, ease: "power3.inOut" }, ${t});
  tl.fromTo("#${incomingId}", { x: "${inX}", y: "${inY}" }, { x: "0%", y: "0%", duration: ${dur}, ease: "power3.inOut" }, ${t});
  window.__timelines["main"].add(tl, 0);
})();`.trim() + "\n"
}

/** zoom-through: outgoing scale(1→1.2) + opacity(1→0), incoming scale(0.8→1) + opacity(0→1) */
function zoomThroughTemplate(
  outgoingId: string,
  incomingId: string,
  config: TransitionConfig,
  startTime: number,
): string {
  const dur = round(config.duration ?? 0.6)
  const t = round(startTime)
  return `
(function() {
  var tl = gsap.timeline({ paused: true });
  tl.to("#${outgoingId}", { scale: 1.2, opacity: 0, duration: ${dur}, ease: "power2.inOut" }, ${t});
  tl.fromTo("#${incomingId}", { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: ${dur}, ease: "power2.inOut" }, ${t});
  window.__timelines["main"].add(tl, 0);
})();`.trim() + "\n"
}

/** squeeze: outgoing scaleX(1→0), incoming scaleX(0→1) (from-center squeeze effect) */
function squeezeTemplate(
  outgoingId: string,
  incomingId: string,
  config: TransitionConfig,
  startTime: number,
): string {
  const dur = round(config.duration ?? 0.6)
  const t = round(startTime)
  return `
(function() {
  var tl = gsap.timeline({ paused: true });
  tl.to("#${outgoingId}", { scaleX: 0, transformOrigin: "center center", duration: ${dur}, ease: "power2.inOut" }, ${t});
  tl.fromTo("#${incomingId}", { scaleX: 0, transformOrigin: "center center" }, { scaleX: 1, duration: ${dur}, ease: "power2.inOut" }, ${t});
  window.__timelines["main"].add(tl, 0);
})();`.trim() + "\n"
}
