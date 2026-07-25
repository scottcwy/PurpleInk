// PageCam: 2.5D camera keyframe interpolation system.
// Generates CSS perspective + GSAP timeline code for cinematic screenshot animations.
// Inspired by video-shotcraft's PageCam system.

/** A single camera keyframe in the 2.5D space. */
export interface CamKey {
  /** Camera X offset (px) */
  cx: number
  /** Camera Y offset (px) */
  cy: number
  /** Zoom level (1.0 = original) */
  zoom: number
  /** X-axis rotation (deg) */
  rotX: number
  /** Y-axis rotation (deg) */
  rotY: number
  /** Z-axis rotation (deg) */
  rotZ: number
  /** Perspective distance (px, typically 800-2000) */
  persp: number
  /** Time point (seconds) */
  t: number
}

/**
 * Build CSS + GSAP animation code from a set of camera keyframes.
 *
 * CSS output: perspective setup for the target container.
 * GSAP output: a sequence of `tl.to()` calls that interpolate between keyframes
 * using the specified easing, producing smooth 2.5D camera motion.
 *
 * The screenshot texture should use `zoom: 2` + `width: 50%` for 2x rasterisation
 * so that 3D transforms keep text sharp (CSS zoom grid-snapping).
 */
export function buildPageCamAnimation(
  keys: CamKey[],
  targetSelector: string,
  ease: string = "power2.inOut",
): { css: string; gsap: string } {
  if (keys.length === 0) {
    return { css: "", gsap: "" }
  }

  // Sort keyframes by time
  const sorted = [...keys].sort((a, b) => a.t - b.t)

  // Use the first keyframe's perspective for the container CSS
  const basePersp = sorted[0]!.persp

  const css = `      ${targetSelector} { perspective: ${basePersp}px; transform-style: preserve-3d; }`

  // Build GSAP timeline lines
  const gsapLines: string[] = []

  // Set initial state from first keyframe
  const k0 = sorted[0]!
  gsapLines.push(
    `      tl.set("${targetSelector}", { ` +
      `x: ${k0.cx}, y: ${k0.cy}, scale: ${k0.zoom}, ` +
      `rotationX: ${k0.rotX}, rotationY: ${k0.rotY}, rotationZ: ${k0.rotZ}, ` +
      `transformPerspective: ${k0.persp} }, 0);`,
  )

  // Animate through subsequent keyframes
  for (let i = 1; i < sorted.length; i++) {
    const k = sorted[i]!
    const prev = sorted[i - 1]!
    const dur = k.t - prev.t
    if (dur <= 0) continue

    // Interpolate perspective if it changes
    const perspChange = k.persp !== prev.persp
    const props: string[] = [
      `x: ${k.cx}`,
      `y: ${k.cy}`,
      `scale: ${k.zoom}`,
      `rotationX: ${k.rotX}`,
      `rotationY: ${k.rotY}`,
      `rotationZ: ${k.rotZ}`,
    ]
    if (perspChange) {
      props.push(`transformPerspective: ${k.persp}`)
    }

    gsapLines.push(
      `      tl.to("${targetSelector}", { ${props.join(", ")}, duration: ${dur}, ease: "${ease}" }, ${prev.t});`,
    )
  }

  return { css, gsap: gsapLines.join("\n") }
}

/**
 * Build a 2x-rasterised screenshot container CSS snippet.
 * Use `zoom: 2` + `width: 50%` so the screenshot renders at 2x resolution,
 * then CSS zoom grid-snaps to ensure text stays sharp under 3D transforms.
 */
export function buildRetinaCss(targetSelector: string): string {
  return `      ${targetSelector} img { zoom: 2; width: 50%; image-rendering: -webkit-optimize-contrast; }`
}

// ============================================================
// Camera Presets
// ============================================================

/** Pre-defined camera motion presets for common cinematic effects. */
export const CAMERA_PRESETS: Record<string, CamKey[]> = {
  /** Slow drift from upper-left to lower-right */
  "drift-down-right": [
    { cx: -60, cy: -200, zoom: 1.08, rotX: 0, rotY: 0, rotZ: 0, persp: 1200, t: 0 },
    { cx: 60, cy: 200, zoom: 1.0, rotX: 0, rotY: 0, rotZ: 0, persp: 1200, t: 1 },
  ],
  /** Straight pan with subtle rotation */
  "pan-straight": [
    { cx: -60, cy: 0, zoom: 1.0, rotX: 0, rotY: 5, rotZ: 0, persp: 1000, t: 0 },
    { cx: 60, cy: 0, zoom: 1.0, rotX: 0, rotY: -5, rotZ: 0, persp: 1000, t: 5 },
  ],
  /** 3D tilt entrance → front-facing */
  "tilt-to-front": [
    { cx: 0, cy: 20, zoom: 0.95, rotX: 8, rotY: -10, rotZ: 2, persp: 800, t: 0 },
    { cx: 0, cy: 0, zoom: 1.0, rotX: 0, rotY: 0, rotZ: 0, persp: 1200, t: 3 },
  ],
  /** Slow zoom-in with micro-rotation */
  "slow-zoom": [
    { cx: 0, cy: 0, zoom: 1.0, rotX: 0, rotY: 0, rotZ: 0, persp: 1200, t: 0 },
    { cx: -10, cy: -10, zoom: 1.12, rotX: 1, rotY: -1, rotZ: 0.5, persp: 1200, t: 5 },
  ],
  /** Dramatic pull-back reveal */
  "pull-back": [
    { cx: 0, cy: 0, zoom: 1.15, rotX: 0, rotY: 0, rotZ: 0, persp: 1000, t: 0 },
    { cx: 20, cy: -10, zoom: 0.95, rotX: -2, rotY: 3, rotZ: -0.5, persp: 1400, t: 4 },
  ],
  /** Gentle orbit around center */
  "gentle-orbit": [
    { cx: -30, cy: 0, zoom: 1.02, rotX: 1, rotY: 6, rotZ: 0, persp: 1200, t: 0 },
    { cx: 30, cy: 0, zoom: 1.02, rotX: 1, rotY: -6, rotZ: 0, persp: 1200, t: 5 },
  ],
}

/**
 * Pick a camera preset by name, with optional duration scaling.
 * Returns a copy with time values scaled to the desired duration.
 */
export function getPreset(name: keyof typeof CAMERA_PRESETS | string, durationSec?: number): CamKey[] {
  const preset = CAMERA_PRESETS[name]
  if (!preset) return CAMERA_PRESETS["drift-down-right"]!

  if (durationSec == null) return preset.map((k) => ({ ...k }))

  const originalDuration = preset[preset.length - 1]!.t
  const scale = originalDuration > 0 ? durationSec / originalDuration : 1
  return preset.map((k) => ({ ...k, t: Math.round(k.t * scale * 100) / 100 }))
}

/**
 * Map a shot type to a recommended camera preset.
 * Used by template.ts to auto-assign camera motion to screenshot shots.
 */
export function presetForShot(shotKind: string): string {
  switch (shotKind) {
    case "shot-window":
      return "drift-down-right"
    case "shot-tilt":
      return "tilt-to-front"
    case "shot-zoom":
      return "slow-zoom"
    default:
      return "drift-down-right"
  }
}
