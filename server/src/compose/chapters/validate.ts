// Validate LLM-generated HyperFrames sub-composition HTML.
// Checks structural conformance to the sub-composition spec before writing to disk.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { Script } from "node:vm"

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

  // 8. LLM 偶尔把 JavaScript 赋值写进 CSS（如 `left=0`），会到渲染编译期才失败。
  const styleBlocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
  if (
    styleBlocks.some((match) =>
      /(?:^|[;{])\s*(?:--[a-z0-9_-]+|[a-z-]+)\s*=(?!=)/imu.test(match[1] ?? "")
    )
  ) {
    errors.push("Invalid CSS assignment syntax")
  }

  // 9. HyperFrames 逐帧 seek 要求动画有限，禁止无限循环。
  if (/\brepeat\s*:\s*-1\b/u.test(html)) {
    errors.push("Infinite GSAP repeat is not seek-safe")
  }

  // 10. 在写盘前编译所有内联脚本；外链 script 没有内联内容，自动跳过。
  const inlineScripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  if (inlineScripts.some((match) => !isValidScript(match[1] ?? ""))) {
    errors.push("Invalid inline script syntax")
  }

  // 11. CSS/JS 块注释若落到标签外会作为可见文字渲染。
  const visibleMarkup = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  if (/\/\*[\s\S]*?\*\//u.test(visibleMarkup)) {
    errors.push("Visible block comment outside style or script")
  }

  // 12. SFMono 并非 HyperFrames 可自动解析字体；无显式声明会产生跨机器字形漂移。
  if (/\bSFMono-Regular\b/iu.test(html) && !/@font-face[\s\S]*SFMono-Regular/iu.test(html)) {
    errors.push("SFMono-Regular requires an explicit @font-face")
  }

  // 13. data-duration must be in 1-60s range
  const durations = [...html.matchAll(/data-duration="([^"]+)"/g)].map((m) => parseFloat(m[1]!))
  for (const d of durations) {
    if (isNaN(d) || d < 1 || d > 60) {
      errors.push(`data-duration out of range [1-60s]: ${d}`)
    }
  }

  return { valid: errors.length === 0, errors }
}

function isValidScript(source: string): boolean {
  try {
    new Script(source)
    return true
  } catch {
    return false
  }
}
