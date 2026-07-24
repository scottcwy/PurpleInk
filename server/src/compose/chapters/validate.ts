// Validate LLM-generated HyperFrames sub-composition HTML.
// Checks structural conformance to the sub-composition spec before writing to disk.
import { existsSync } from "node:fs"
import { join } from "node:path"

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validate that an HTML string conforms to the HyperFrames sub-composition spec.
 *
 * @param html         The generated HTML string
 * @param chapterId    Expected chapter ID (e.g. "ch1-opening")
 * @param assetFiles   Optional list of asset file paths (relative) to check <img> src against
 * @param assetsDir    Optional absolute path to the assets directory for file existence checks
 */
export function validateHyperFramesHtml(
  html: string,
  chapterId: string,
  assetFiles?: string[],
  assetsDir?: string,
): ValidationResult {
  const errors: string[] = []

  // 1. Must contain data-composition-id matching chapterId
  const compIdMatch = html.match(/data-composition-id="([^"]+)"/)
  if (!compIdMatch) {
    errors.push("Missing data-composition-id attribute")
  } else if (compIdMatch[1] !== chapterId) {
    errors.push(`data-composition-id mismatch: expected "${chapterId}", got "${compIdMatch[1]}"`)
  }

  // 2. Must have correct canvas dimensions
  if (!html.includes('data-width="1920"')) {
    errors.push('Missing data-width="1920"')
  }
  if (!html.includes('data-height="1080"')) {
    errors.push('Missing data-height="1080"')
  }

  // 3. Must register GSAP timeline
  if (!html.includes("window.__timelines")) {
    errors.push("Missing window.__timelines registration")
  }

  // 4. Must use paused timeline
  if (!html.includes("gsap.timeline({ paused: true })") && !html.includes("gsap.timeline({paused:true})")) {
    // Also accept with spaces variations
    const pausedPattern = /gsap\.timeline\(\s*\{\s*paused\s*:\s*true\s*\}\s*\)/
    if (!pausedPattern.test(html)) {
      errors.push("Missing gsap.timeline({ paused: true })")
    }
  }

  // 5. Check <img> src files exist (if assetFiles list provided)
  if (assetFiles && assetFiles.length > 0) {
    const imgSrcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]!)
    for (const src of imgSrcs) {
      // Skip data URIs and external URLs
      if (src.startsWith("data:") || src.startsWith("http://") || src.startsWith("https://")) continue
      // Check if the src references a known asset file
      const baseName = src.replace(/^assets\//, "")
      if (!assetFiles.includes(baseName) && !assetFiles.includes(src)) {
        // If assetsDir is provided, check file existence on disk
        if (assetsDir) {
          const fullPath = join(assetsDir, src.replace(/^assets\//, ""))
          if (!existsSync(fullPath)) {
            errors.push(`Image src not found in assets: ${src}`)
          }
        }
      }
    }

    // 5b. Check <video> src files exist (same logic as <img>)
    const videoSrcs = [...html.matchAll(/<video[^>]*src="([^"]+)"/g)].map((m) => m[1]!)
    for (const src of videoSrcs) {
      if (src.startsWith("data:") || src.startsWith("http://") || src.startsWith("https://")) continue
      const baseName = src.replace(/^assets\//, "")
      if (!assetFiles.includes(baseName) && !assetFiles.includes(src)) {
        if (assetsDir) {
          const fullPath = join(assetsDir, src.replace(/^assets\//, ""))
          if (!existsSync(fullPath)) {
            errors.push(`Video asset not found: ${src}`)
          }
        }
      }
    }
  }

  // 6. Forbidden elements
  if (/<iframe[\s>]/i.test(html)) {
    errors.push("Forbidden: <iframe> element found")
  }
  if (/<form[\s>]/i.test(html)) {
    errors.push("Forbidden: <form> element found")
  }
  if (html.includes("fetch(")) {
    errors.push("Forbidden: fetch() call found")
  }
  if (html.includes("XMLHttpRequest")) {
    errors.push("Forbidden: XMLHttpRequest reference found")
  }

  // 7. No CSS @keyframes (must use GSAP only)
  if (/@keyframes\s/.test(html)) {
    errors.push("Forbidden: CSS @keyframes found (use GSAP timelines only)")
  }

  // 8. data-duration must be in 1-60s range
  const durations = [...html.matchAll(/data-duration="([^"]+)"/g)].map((m) => parseFloat(m[1]!))
  for (const d of durations) {
    if (isNaN(d) || d < 1 || d > 60) {
      errors.push(`data-duration out of range [1-60s]: ${d}`)
    }
  }

  return { valid: errors.length === 0, errors }
}

export interface AiPatternResult {
  severity: "ok" | "warning" | "critical"
  issues: string[]
}

export function detectAiPatterns(html: string): AiPatternResult {
  const issues: string[] = []
  let severity: "ok" | "warning" | "critical" = "ok"

  const gradientCount = (html.match(/linear-gradient|radial-gradient/gi) || []).length
  if (gradientCount > 8) {
    issues.push(`Excessive gradients: ${gradientCount}`)
    severity = "critical"
  }

  const textShadowCount = (html.match(/text-shadow/gi) || []).length
  const boxShadowCount = (html.match(/box-shadow/gi) || []).length
  if (textShadowCount > 3 && boxShadowCount > 5) {
    issues.push(`Excessive glow: text-shadow(${textShadowCount}) + box-shadow(${boxShadowCount})`)
    severity = "critical"
  }

  if (/lorem ipsum|placeholder|sample text|TODO|FIXME/i.test(html)) {
    issues.push("Placeholder text detected")
    severity = "critical"
  }

  const blurCount = (html.match(/backdrop-filter\s*:\s*blur/gi) || []).length
  if (blurCount > 3) {
    issues.push(`Excessive glassmorphism: ${blurCount}`)
    if (severity === "ok") severity = "warning"
  }

  if (boxShadowCount > 10) {
    issues.push(`Excessive box-shadow: ${boxShadowCount}`)
    if (severity === "ok") severity = "warning"
  }

  const emptyDivs = html.match(/<div[^>]*>\s*<\/div>/g) || []
  if (emptyDivs.length > 5) {
    issues.push(`Empty containers: ${emptyDivs.length}`)
    if (severity === "ok") severity = "warning"
  }

  return { severity, issues }
}
