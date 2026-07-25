// Storyboard → HTML conversion.
// Converts a Storyboard's shots into per-chapter HTML strings,
// each a self-contained sub-composition with CSS + GSAP timeline.
import type { Storyboard, StoryboardShot } from "./types"
import type { ChapterId, ChapterPlan, ComposeContext } from "../chapters/types"
import type { VideoModel, Scene, Palette } from "../model"
import { getBlueprintMapping } from "../blueprint-mapping.js"
import { renderTemplateChapter } from "../chapters/template-fallback"
import { springPopEntrance, depthScatterAssemble, countingDynamicScale, centerOutwardExpansion } from "../motion-rules"

const GSAP_CDN = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"

const ALL_CHAPTERS: ChapterId[] = [
  "ch1-opening", "ch2-hero", "ch3-showcase", "ch4-proof", "ch5-cta",
]

/**
 * Convert a Storyboard into per-chapter HTML.
 * Returns a Map<ChapterId, html> for all 5 chapters.
 */
export function storyboardToChapters(
  sb: Storyboard,
  _ctx: ComposeContext,
  _captureDir: string,
  _model: VideoModel,
): Map<ChapterId, string> {
  const result = new Map<ChapterId, string>()

  // Try the rich rendering path via template-fallback first
  let templateModel: VideoModel | null = null
  try {
    templateModel = storyboardShotsToVideoModel(sb)
  } catch {
    templateModel = null
  }

  // Group shots by chapter
  const chapterShots = new Map<ChapterId, StoryboardShot[]>()
  for (const shot of sb.shots) {
    const shots = chapterShots.get(shot.chapter) || []
    shots.push(shot)
    chapterShots.set(shot.chapter, shots)
  }

  // Generate HTML for each chapter
  for (const chId of ALL_CHAPTERS) {
    const shots = chapterShots.get(chId) || []

    // ch3-showcase always uses the fallback path (renderChapterHtml)
    // because its shot types (data-counter, feature-stack, etc.) are not
    // in the template-fallback's shotToChapter ch3 mapping.
    if (chId === "ch3-showcase") {
      const html = renderChapterHtml(chId, shots, sb)
      result.set(chId, html)
      continue
    }

    // Prefer renderTemplateChapter() for rich 4-layer + PageCam + motion-rules rendering
    if (templateModel) {
      // Build a sub-VideoModel containing only this chapter's scenes,
      // so renderTemplateChapter() can't mis-route them via shotToChapter().
      const chapterScenes = shots
        .map((shot) => {
          const idx = sb.shots.findIndex((s) => s.id === shot.id)
          return idx >= 0 ? templateModel.scenes[idx] : null
        })
        .filter((s): s is Scene => s != null)

      if (chapterScenes.length > 0) {
        const subModel = { ...templateModel, scenes: chapterScenes }
        try {
          const html = renderTemplateChapter(chId, subModel)
          if (html && html.length > 100) {
            result.set(chId, html)
            continue
          }
        } catch {
          // Fall through to simple rendering
        }
      }
    }

    // Fallback: simple 3-layer rendering
    const html = renderChapterHtml(chId, shots, sb)
    result.set(chId, html)
  }

  return result
}

// ---------------------------------------------------------------------------
// StoryboardShot[] → VideoModel conversion
// ---------------------------------------------------------------------------

/**
 * Convert storyboard shots + metadata into a VideoModel suitable for
 * renderTemplateChapter(). This allows reusing the rich 4-layer rendering
 * with PageCam camera motion and motion-rules animations.
 */
function storyboardShotsToVideoModel(sb: Storyboard): VideoModel {
  const meta = sb.meta
  const palette: Palette = {
    ...meta.palette,
    fontFamily: meta.fontFamily,
  }

  // Derive brand/hero/cta from storyboard shots' screenText
  const brandShot = sb.shots.find((s) => s.type === "brand-center" || s.type === "brand-side")
  const heroShot = sb.shots.find((s) => s.type === "hero-split" || s.type === "hero-stack")
  const ctaShot = sb.shots.find((s) => s.type === "cta-push" || s.type === "cta-fullbleed")

  const brand = {
    title: brandShot?.screenText?.headline || meta.brand,
    tagline: brandShot?.screenText?.subheadline || meta.tagline,
  }

  const hero = {
    headline: heroShot?.screenText?.headline || meta.brand,
    lede: heroShot?.screenText?.subheadline || "",
    ctas: heroShot?.screenText?.labels?.slice(0, 2) || [],
    chips: heroShot?.screenText?.labels?.slice(0, 6) || [],
  }

  // Extract value props from feature shots
  const featureShot = sb.shots.find((s) => s.type === "feature-row" || s.type === "feature-stack")
  const valueProps = (featureShot?.screenText?.data || []).map((d) => ({
    title: d.label,
    desc: d.value,
  }))

  // Logo wall shot
  const logoShot = sb.shots.find((s) => s.type === "logo-wall")
  const logos = logoShot?.screenText?.labels || []

  // Pricing shot
  const pricingShot = sb.shots.find((s) => s.type === "pricing")
  const pricing = (pricingShot?.screenText?.data || []).map((d) => ({
    name: d.label,
    price: d.value,
  }))

  const cta = {
    headline: ctaShot?.screenText?.headline || "Get started.",
    command: ctaShot?.screenText?.command || "",
  }

  // Convert all shots to Scene[]
  const scenes: Scene[] = sb.shots.map((shot) => {
    const scene: Scene = {
      kind: shot.type,
      start: shot.startTime,
      duration: shot.duration,
    }

    // Map assets to ShotMaterial[]
    if (shot.assets && shot.assets.length > 0) {
      scene.shots = shot.assets.map((src, i) => ({
        src,
        caption: shot.screenText?.headline || shot.visualDescription || `Screenshot ${i + 1}`,
        tall: true,
      }))
    }

    // Map screenText.data to stats for data-counter / data-chart
    if (shot.screenText?.data && (shot.type === "data-counter" || shot.type === "data-chart")) {
      scene.stats = shot.screenText.data.map((d) => ({
        value: d.value,
        label: d.label,
      }))
    }

    return scene
  })

  // Derive skin from storyboard meta
  const skinId = meta.skin as VideoModel["skin"]["id"]
  const validSkins: VideoModel["skin"]["id"][] = ["editorial", "kinetic", "technical"]
  const skin = validSkins.includes(skinId) ? skinId : "editorial"

  const SKIN_MAP: Record<string, VideoModel["skin"]> = {
    editorial: { id: "editorial", motion: { enter: "power2.out", transition: "crossfade" }, minShot: 3.0, maxShots: 7 },
    kinetic: { id: "kinetic", motion: { enter: "expo.out", transition: "flash" }, minShot: 2.0, maxShots: 12 },
    technical: { id: "technical", motion: { enter: "power4.out", transition: "cut" }, minShot: 2.4, maxShots: 9 },
  }

  const totalDuration = scenes.reduce((sum, s) => sum + s.duration, 0)

  return {
    id: "storyboard-video",
    name: meta.brand,
    brand,
    hero,
    valueProps,
    logos,
    pricing,
    cta,
    palette,
    skin: SKIN_MAP[skin] || SKIN_MAP.editorial!,
    scenes,
    durationSec: totalDuration,
  }
}

// ---------------------------------------------------------------------------
// Chapter HTML rendering (fallback path)
// ---------------------------------------------------------------------------

function renderChapterHtml(
  chapterId: ChapterId,
  shots: StoryboardShot[],
  sb: Storyboard,
): string {
  const palette = sb.meta.palette

  if (shots.length === 0) {
    return buildEmptyChapter(chapterId, palette)
  }

  // Re-time shots so the first one starts at 0 (chapter-local timeline)
  const firstStart = shots[0]!.startTime
  const reTimed = shots.map((s) => ({ ...s, startTime: s.startTime - firstStart }))

  // Generate CSS variables
  const cssVars = `--fg: ${palette.fg}; --bg: ${palette.bg}; --accent: ${palette.accent}; --accent-fg: ${palette.accentFg}; --muted: ${palette.muted}; --secondary: ${palette.secondary}; --border: ${palette.border}; --radius: 10px;`

  // Generate each shot's clip HTML
  const clipsHtml = reTimed
    .map((shot, i) => {
      const localStart = reTimed.slice(0, i).reduce((s, sh) => s + sh.duration, 0)
      return renderShotClip(shot, localStart)
    })
    .join("\n")

  // Generate GSAP timeline code
  const gsapCode = reTimed
    .map((shot, i) => {
      const localStart = reTimed.slice(0, i).reduce((s, sh) => s + sh.duration, 0)
      return renderShotTimeline(shot, localStart)
    })
    .join("\n")

  return `<template id="${chapterId}-template">
      <div data-composition-id="${chapterId}" data-width="1920" data-height="1080">
        <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--bg); }
      :root { ${cssVars} }
      body { font-family: ${esc(sb.meta.fontFamily)}, system-ui, sans-serif; color: var(--fg); -webkit-font-smoothing: antialiased; }
      .clip { position: absolute; inset: 0; overflow: hidden; }
      .clip[hidden] { display: none; }
      .mono { font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace; }

      /* Depth layers */
      .depth-bg { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
      .depth-content { position: absolute; inset: 0; z-index: 2; }
      .depth-fg { position: absolute; inset: 0; z-index: 3; pointer-events: none; overflow: hidden; }

      /* Background types */
      .depth-bg.grid {
        background-image:
          repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px 80px),
          repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px 80px);
        opacity: 0.3;
      }
      .depth-bg.gradient {
        background: radial-gradient(ellipse at 30% 40%, var(--accent) 8%, transparent 60%);
        opacity: 0.06;
      }

      /* Typography */
      .shot-eyebrow { font-size: 14px; text-transform: uppercase; letter-spacing: 3px; color: var(--accent); }
      .shot-headline { font-size: 56px; font-weight: 800; letter-spacing: -2px; line-height: 1.1; overflow-wrap: break-word; }
      .shot-subheadline { font-size: 22px; color: var(--muted); max-width: 600px; line-height: 1.5; }
      .shot-label { font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: var(--muted); }

      /* Browser window */
      .shot-window { border-radius: 12px; overflow: hidden; border: 1px solid var(--border);
        box-shadow: 0 20px 60px rgba(0,0,0,0.15); background: var(--bg); }
      .shot-window-bar { height: 32px; background: var(--secondary); display: flex; align-items: center;
        padding: 0 12px; gap: 6px; }
      .shot-window-dot { width: 10px; height: 10px; border-radius: 50%; }
      .shot-window-dot.r { background: #ff5f57; }
      .shot-window-dot.y { background: #febc2e; }
      .shot-window-dot.g { background: #28c840; }
      .shot-window-url { margin-left: 12px; font-size: 13px; color: var(--muted); }
      .shot-window img { width: 100%; display: block; object-fit: cover; }

      /* Feature cards */
      .feat-card { padding: 24px; border: 1px solid var(--border); border-radius: 12px;
        background: var(--secondary); }
      .feat-card-title { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
      .feat-card-desc { font-size: 14px; color: var(--muted); line-height: 1.5; }

      /* Data counters */
      .data-value { font-size: 48px; font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; }
      .data-label { font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: var(--muted); }

      /* CTA */
      .cta-btn { display: inline-block; padding: 14px 32px; background: var(--accent);
        color: var(--accent-fg); border-radius: 10px; font-weight: 700; font-size: 18px; }
      .cta-cmd { font-size: 16px; color: var(--muted); }

      /* Logo wall */
      .logo-cell { padding: 16px 24px; border: 1px solid var(--border); border-radius: 8px;
        background: var(--secondary); font-size: 18px; font-weight: 700; text-align: center; }
        </style>
${clipsHtml}
        <script src="${GSAP_CDN}"></script>
        <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
${gsapCode}
      window.__timelines["${chapterId}"] = tl;
        </script>
      </div>
    </template>`
}

// ---------------------------------------------------------------------------
// Clip rendering per shot type
// ---------------------------------------------------------------------------

function renderShotClip(shot: StoryboardShot, localStart: number): string {
  const depthBgClass = shot.layers?.background?.type === "grid" ? "grid" : "gradient"
  const inner = renderShotInner(shot)

  // Build data attributes from new HyperFrames metadata
  const dataAttrs: string[] = [
    `data-start="${round(localStart)}"`,
    `data-duration="${round(shot.duration)}"`,
    `data-track-index="1"`,
  ]
  if (shot.transition_in) {
    dataAttrs.push(`data-transition="${esc(shot.transition_in)}"`)
  }
  if (shot.src) {
    dataAttrs.push(`data-composition-src="${esc(shot.src)}"`)
  }
  if (shot.blueprint) {
    dataAttrs.push(`data-blueprint="${esc(shot.blueprint)}"`)
  }

  // Blueprint comment for debugging — enhanced with motion rules (Phase 3)
  const mapping = shot.blueprint ? getBlueprintMapping(shot.type) : undefined
  const rulesList = mapping ? mapping.motionRules.join(", ") : ""
  const blueprintComment = shot.blueprint
    ? `<!-- blueprint: ${esc(shot.blueprint)} | rules: [${esc(rulesList)}] -->\n  `
    : mapping
      ? `<!-- blueprint: ${esc(mapping.blueprintId)} | rules: [${esc(rulesList)}] -->\n  `
      : ""

  return `${blueprintComment}<div id="s_${shot.id}" class="clip" ${dataAttrs.join(" ")}>
  <div class="depth-bg ${depthBgClass}"></div>
  <div class="depth-content">${inner}</div>
  <div class="depth-fg"></div>
</div>`
}

function renderShotInner(shot: StoryboardShot): string {
  switch (shot.type) {
    case "brand-center":
      return `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;gap:16px;">
          ${shot.screenText?.eyebrow ? `<div class="shot-eyebrow">${esc(shot.screenText.eyebrow)}</div>` : ""}
          <div class="shot-headline" style="font-size:84px;">${esc(shot.screenText?.headline || "")}</div>
          ${shot.screenText?.subheadline ? `<div class="shot-subheadline">${esc(shot.screenText.subheadline)}</div>` : ""}
        </div>`

    case "brand-side":
      return `
        <div style="display:flex;align-items:center;gap:56px;padding:0 180px;height:100%;">
          <div style="width:12px;height:460px;background:var(--accent);border-radius:6px;"></div>
          <div style="display:flex;flex-direction:column;gap:16px;">
            ${shot.screenText?.eyebrow ? `<div class="shot-eyebrow">${esc(shot.screenText.eyebrow)}</div>` : ""}
            <div class="shot-headline" style="font-size:80px;text-align:left;">${esc(shot.screenText?.headline || "")}</div>
            ${shot.screenText?.subheadline ? `<div class="shot-subheadline" style="text-align:left;">${esc(shot.screenText.subheadline)}</div>` : ""}
          </div>
        </div>`

    case "hero-split":
      return `
        <div style="display:grid;grid-template-columns:1fr 1fr;height:100%;align-items:center;padding:0 80px;gap:60px;">
          <div style="display:flex;flex-direction:column;gap:16px;">
            ${shot.screenText?.eyebrow ? `<div class="shot-eyebrow">${esc(shot.screenText.eyebrow)}</div>` : ""}
            <div class="shot-headline">${esc(shot.screenText?.headline || "")}</div>
            ${shot.screenText?.subheadline ? `<div class="shot-subheadline">${esc(shot.screenText.subheadline)}</div>` : ""}
          </div>
          <div>${renderAssets(shot)}</div>
        </div>`

    case "hero-stack":
      return `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;gap:20px;">
          ${shot.screenText?.eyebrow ? `<div class="shot-eyebrow">${esc(shot.screenText.eyebrow)}</div>` : ""}
          <div class="shot-headline">${esc(shot.screenText?.headline || "")}</div>
          ${shot.screenText?.subheadline ? `<div class="shot-subheadline">${esc(shot.screenText.subheadline)}</div>` : ""}
          ${shot.screenText?.labels ? `<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">${shot.screenText.labels.map((l) => `<span class="shot-label" style="border:1px solid var(--border);padding:6px 16px;border-radius:20px;">${esc(l)}</span>`).join("")}</div>` : ""}
        </div>`

    case "shot-window":
    case "shot-tilt":
    case "shot-zoom":
      return `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;">
          ${shot.screenText?.headline ? `<div class="shot-headline" style="font-size:36px;">${esc(shot.screenText.headline)}</div>` : ""}
          <div class="shot-window" style="width:1200px;max-height:600px;">
            <div class="shot-window-bar">
              <span class="shot-window-dot r"></span>
              <span class="shot-window-dot y"></span>
              <span class="shot-window-dot g"></span>
              <span class="shot-window-url mono">${esc(shot.assets?.[0] || "")}</span>
            </div>
            ${renderAssets(shot)}
          </div>
        </div>`

    case "shot-split":
      return `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:48px;padding:0 90px;align-items:center;height:100%;">
          ${renderSplitPanes(shot)}
        </div>`

    case "feature-row":
      return `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:32px;padding:0 80px;">
          ${shot.screenText?.headline ? `<div class="shot-headline" style="font-size:36px;text-align:center;">${esc(shot.screenText.headline)}</div>` : ""}
          <div style="display:flex;gap:24px;width:100%;">
            ${(shot.screenText?.data || []).map((d) => `
              <div class="feat-card" style="flex:1;">
                <div class="feat-card-title">${esc(d.label)}</div>
                <div class="feat-card-desc">${esc(d.value)}</div>
              </div>
            `).join("")}
          </div>
        </div>`

    case "feature-stack":
      return `
        <div style="display:flex;flex-direction:column;align-items:stretch;justify-content:center;gap:24px;padding:0 320px;">
          ${shot.screenText?.headline ? `<div class="shot-headline" style="font-size:36px;text-align:center;margin-bottom:16px;">${esc(shot.screenText.headline)}</div>` : ""}
          ${(shot.screenText?.data || []).map((d, i) => `
            <div style="display:flex;align-items:flex-start;gap:24px;border-bottom:1px solid var(--border);padding-bottom:20px;">
              <div style="font-size:28px;color:var(--accent);font-weight:700;min-width:40px;">${String(i + 1).padStart(2, "0")}</div>
              <div>
                <div style="font-size:24px;font-weight:700;">${esc(d.label)}</div>
                <div style="font-size:16px;color:var(--muted);line-height:1.5;margin-top:6px;">${esc(d.value)}</div>
              </div>
            </div>
          `).join("")}
        </div>`

    case "data-counter":
      return `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;gap:80px;">
          ${(shot.screenText?.data || []).map((d) => `
            <div style="text-align:center;">
              <div class="data-value">${esc(d.value)}</div>
              <div class="data-label">${esc(d.label)}</div>
            </div>
          `).join("")}
        </div>`

    case "chips-marquee":
      return `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;overflow:hidden;">
          <div style="display:flex;gap:18px;flex-wrap:wrap;justify-content:center;max-width:1400px;">
            ${(shot.screenText?.labels || []).map((l) => `<span class="shot-label" style="border:1px solid var(--border);padding:10px 24px;border-radius:20px;font-size:18px;">${esc(l)}</span>`).join("")}
          </div>
        </div>`

    case "logo-wall":
      return `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:32px;">
          ${shot.screenText?.headline ? `<div class="shot-headline" style="font-size:32px;">${esc(shot.screenText.headline)}</div>` : ""}
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:20px;max-width:1200px;width:100%;">
            ${renderAssets(shot)}
          </div>
        </div>`

    case "pricing":
      return `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;gap:32px;padding:0 120px;">
          ${(shot.screenText?.data || []).map((d, i) => `
            <div style="width:340px;min-height:360px;border:1px solid var(--border);border-radius:16px;padding:40px 32px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;${i === 1 ? "background:var(--accent);color:var(--accent-fg);transform:scale(1.05);" : "background:var(--bg);"}">
              <div style="font-size:28px;font-weight:700;">${esc(d.label)}</div>
              <div style="font-size:48px;font-weight:800;" class="mono">${esc(d.value)}</div>
            </div>
          `).join("")}
        </div>`

    case "cta-push":
    case "cta-fullbleed": {
      const isFull = shot.type === "cta-fullbleed"
      return `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:20px;text-align:center;${isFull ? "background:var(--accent);color:var(--accent-fg);" : ""}">
          <div class="shot-headline" style="font-size:72px;">${esc(shot.screenText?.headline || "")}</div>
          ${shot.screenText?.subheadline ? `<div class="shot-subheadline">${esc(shot.screenText.subheadline)}</div>` : ""}
          ${shot.screenText?.command ? `<div class="cta-cmd mono">${esc(shot.screenText.command)}</div>` : ""}
        </div>`
    }

    default:
      // Generic fallback
      return `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:16px;text-align:center;">
          ${shot.screenText?.headline ? `<div class="shot-headline">${esc(shot.screenText.headline)}</div>` : ""}
          ${shot.screenText?.subheadline ? `<div class="shot-subheadline">${esc(shot.screenText.subheadline)}</div>` : ""}
          ${renderAssets(shot)}
        </div>`
  }
}

// ---------------------------------------------------------------------------
// Timeline rendering per shot
// ---------------------------------------------------------------------------

function renderShotTimeline(shot: StoryboardShot, localStart: number): string {
  const sel = `#s_${shot.id}`
  const at = (d: number) => round(localStart + d)
  const ease = shot.choreography?.enterEase || "power3.out"

  const lines: string[] = []

  // Shot-type-specific entrance animation using motion-rules
  switch (shot.type) {
    case "brand-center":
      lines.push(springPopEntrance(`${sel} .shot-headline`, at(0.2)))
      break
    case "brand-side":
      lines.push(springPopEntrance(`${sel} .shot-headline`, at(0.2)))
      break
    case "hero-split":
    case "hero-stack":
      lines.push(springPopEntrance(`${sel} .shot-headline`, at(0.3)))
      break
    case "feature-row":
    case "feature-stack":
      lines.push(...depthScatterAssemble(
        (shot.screenText?.data || []).map((_, i) => `${sel} .feat-card:nth-child(${i + 1})`),
        at(0.2),
      ))
      break
    case "data-counter":
      lines.push(...(shot.screenText?.data || []).map((_, i) =>
        countingDynamicScale(`${sel} .data-value:nth-child(${i + 1})`, at(0.2 + i * 0.14)),
      ))
      break
    case "logo-wall":
      lines.push(springPopEntrance(`${sel} .shot-headline`, at(0.2)))
      break
    case "cta-push":
    case "cta-fullbleed":
      lines.push(springPopEntrance(`${sel} .shot-headline`, at(0.2)))
      break
    case "shot-split":
      lines.push(...centerOutwardExpansion(
        [`${sel} .sp-pane-a`, `${sel} .sp-pane-b`],
        at(0.2),
      ))
      break
    default:
      // Generic entrance for other shot types
      lines.push(`tl.from("${sel} .depth-content", { opacity: 0, y: 30, duration: 0.8, ease: "${ease}" }, ${at(0.1)});`)
      break
  }

  // Background parallax
  lines.push(`tl.fromTo("${sel} .depth-bg", { x: -8, y: -4 }, { x: 8, y: 4, duration: ${shot.duration}, ease: "sine.inOut" }, ${at(0)});`)

  // Exit animation
  const exitDelay = shot.choreography?.exitDelay || 0.15
  const exitStart = Math.max(0.1, shot.duration - exitDelay)
  lines.push(`tl.to("${sel} .depth-content", { opacity: 0, y: -20, duration: 0.5, ease: "power2.in" }, ${at(exitStart)});`)

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderAssets(shot: StoryboardShot): string {
  if (!shot.assets || shot.assets.length === 0) return ""
  return shot.assets
    .map((a) => {
      const src = a.replace(/^assets\//, "")
      if (/\.(png|jpe?g|webp)$/i.test(a)) {
        return `<img src="assets/${esc(src)}" style="width:100%;border-radius:8px;" />`
      }
      if (/\.mp4$/i.test(a)) {
        return `<video src="assets/${esc(src)}" autoplay muted loop playsinline style="width:100%;border-radius:8px;" />`
      }
      return `<span>${esc(a)}</span>`
    })
    .join("")
}

function renderSplitPanes(shot: StoryboardShot): string {
  const assets = shot.assets || []
  const pane = (src: string, badge: string) => `
    <div style="position:relative;height:600px;border-radius:14px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.15);background:var(--secondary);">
      <span style="position:absolute;top:16px;left:16px;z-index:2;padding:6px 16px;border-radius:999px;font-size:18px;font-weight:600;background:var(--accent);color:var(--accent-fg);">${badge}</span>
      ${src ? `<img src="assets/${esc(src.replace(/^assets\//, ""))}" style="width:100%;height:100%;object-fit:cover;display:block;" />` : ""}
    </div>`
  return pane(assets[0] || "", "Before") + pane(assets[1] || assets[0] || "", "After")
}

function buildEmptyChapter(
  chapterId: ChapterId,
  palette: { fg: string; bg: string },
): string {
  return `<template id="${chapterId}-template">
      <div data-composition-id="${chapterId}" data-width="1920" data-height="1080">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body { width: 1920px; height: 1080px; overflow: hidden; background: ${palette.bg}; }
        </style>
        <script src="${GSAP_CDN}"></script>
        <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      window.__timelines["${chapterId}"] = tl;
        </script>
      </div>
    </template>`
}

/**
 * Derive ChapterPlan[] from a Storyboard.
 * Computes sequential, non-overlapping chapter timing from the storyboard's
 * actual shot startTime/duration values. This ensures the root HTML timing
 * matches the storyboard content (not the template model's scene layout).
 */
export function storyboardToChapterPlans(sb: Storyboard): ChapterPlan[] {
  const ALL_CHAPTERS: ChapterId[] = [
    "ch1-opening", "ch2-hero", "ch3-showcase", "ch4-proof", "ch5-cta",
  ]
  const CHAPTER_META: Record<ChapterId, { title: string }> = {
    "ch1-opening":  { title: "Opening" },
    "ch2-hero":     { title: "Hero" },
    "ch3-showcase": { title: "Showcase" },
    "ch4-proof":    { title: "Proof" },
    "ch5-cta":      { title: "Call to Action" },
  }

  // Group shots by chapter
  const chapterShots = new Map<ChapterId, StoryboardShot[]>()
  for (const chId of ALL_CHAPTERS) chapterShots.set(chId, [])
  for (const shot of sb.shots) {
    const shots = chapterShots.get(shot.chapter) || []
    shots.push(shot)
    chapterShots.set(shot.chapter, shots)
  }

  // Compute timing per chapter from storyboard shot times
  const rawPlans: Map<ChapterId, ChapterPlan> = new Map()
  for (const id of ALL_CHAPTERS) {
    const shots = chapterShots.get(id) || []
    const meta = CHAPTER_META[id]
    if (shots.length === 0) {
      rawPlans.set(id, { id, title: meta.title, startSec: 0, durationSec: 0, shotTypes: [], assets: [] })
      continue
    }
    const startSec = Math.min(...shots.map((s) => s.startTime))
    const endSec = Math.max(...shots.map((s) => s.startTime + s.duration))
    const durationSec = Math.max(1, endSec - startSec)
    const shotTypes = shots.map((s) => s.type)
    const assets: string[] = []
    if (id === "ch3-showcase") {
      for (const shot of shots) {
        for (const a of shot.assets || []) assets.push(a)
      }
    }
    rawPlans.set(id, { id, title: meta.title, startSec, durationSec, shotTypes, assets })
  }

  // Build sequential timeline: each chapter starts where the previous one ends
  const plans: ChapterPlan[] = []
  let cursor = 0
  for (const id of ALL_CHAPTERS) {
    const raw = rawPlans.get(id)!
    if (raw.durationSec === 0) {
      plans.push({ ...raw, startSec: cursor })
      continue
    }
    plans.push({ ...raw, startSec: cursor })
    cursor += raw.durationSec
  }

  // Adjust last chapter to match total duration – distribute slack proportionally
  const totalDuration = sb.meta.totalDuration
  const nonEmpty = plans.filter((p) => p.durationSec > 0)
  if (nonEmpty.length > 0 && cursor > 0 && totalDuration > cursor) {
    const diff = totalDuration - cursor
    nonEmpty.forEach((p) => {
      p.durationSec += diff * (p.durationSec / cursor)
    })
    // Recompute startSec after redistribution
    let c = 0
    for (const p of plans) {
      p.startSec = c
      c += p.durationSec
    }
  }

  return plans
}

function esc(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
