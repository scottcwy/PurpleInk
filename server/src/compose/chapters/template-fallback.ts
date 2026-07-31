// Template fallback: render a single chapter as a sub-composition HTML string
// using the existing template.ts shot definitions. This is the fallback when
// the LLM doesn't generate a chapter (or for pure-template mode).
import type { VideoModel, Scene, ShotType } from "../model"
import type { ChapterId } from "./types"
import { buildPageCamAnimation, getPreset, presetForShot } from "./page-cam"

const GSAP_CDN = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function esc(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Map a shot type to its chapter */
function shotToChapter(kind: ShotType): ChapterId {
  if (kind === "brand-center" || kind === "brand-side") return "ch1-opening"
  if (kind === "hero-split" || kind === "hero-stack") return "ch2-hero"
  if (kind === "shot-window" || kind === "shot-tilt" || kind === "shot-zoom" || kind === "shot-split") return "ch3-showcase"
  if (
    kind === "feature-row" || kind === "feature-stack" ||
    kind === "data-counter" || kind === "chips-marquee" ||
    kind === "logo-wall" || kind === "pricing"
  ) return "ch4-proof"
  return "ch5-cta"
}

/**
 * Render a single chapter as a sub-composition HTML string.
 *
 * Output format:
 * ```html
 * <template id="ch1-template">
 *   <div data-composition-id="ch1-opening" data-width="1920" data-height="1080">
 *     <style>...</style>
 *     <!-- clips -->
 *     <script src="gsap CDN"></script>
 *     <script>
 *       window.__timelines = window.__timelines || {};
 *       const tl = gsap.timeline({ paused: true });
 *       // tweens...
 *       window.__timelines["ch1-opening"] = tl;
 *     </script>
 *   </div>
 * </template>
 * ```
 *
 * This re-uses the shot rendering logic from template.ts by importing
 * renderIndexHtml and extracting only the relevant scenes for the chapter.
 */
export function renderTemplateChapter(chapterId: ChapterId, model: VideoModel): string {
  // Filter scenes belonging to this chapter
  const chapterScenes = model.scenes.filter((s) => shotToChapter(s.kind) === chapterId)

  if (chapterScenes.length === 0) {
    // Empty chapter: return minimal template
    return buildEmptyTemplate(chapterId)
  }

  // Build a sub-model with only this chapter's scenes, re-timed to start at 0
  const subModel = buildSubModel(model, chapterScenes)

  // Render clips and timeline using the same approach as template.ts
  // We inline the rendering here to avoid circular dependencies
  const clipsHtml = renderClips(subModel)
  const timelineJs = renderTimeline(subModel)
  const css = renderCss(subModel)

  return `<template id="${chapterId}-template">
      <div data-composition-id="${chapterId}" data-width="1920" data-height="1080">
        <style>
${css}
        </style>
${clipsHtml}
        <script src="${GSAP_CDN}"></script>
        <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${timelineJs}
      window.__timelines["${chapterId}"] = tl;
        </script>
      </div>
    </template>`
}

/** Build a minimal VideoModel-like object with only the chapter's scenes, re-timed to 0 */
function buildSubModel(model: VideoModel, scenes: Scene[]): VideoModel {
  // Re-time scenes so the first one starts at 0
  const firstStart = scenes.length > 0 ? scenes[0]!.start : 0
  const reTimed = scenes.map((s) => ({
    ...s,
    start: round(s.start - firstStart),
  }))
  const duration = reTimed.reduce((sum, s) => sum + s.duration, 0)

  return {
    ...model,
    scenes: reTimed,
    durationSec: round(duration),
  }
}

function buildEmptyTemplate(chapterId: ChapterId): string {
  return `<template id="${chapterId}-template">
      <div data-composition-id="${chapterId}" data-width="1920" data-height="1080">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body { width: 1920px; height: 1080px; overflow: hidden; }
        </style>
        <script src="${GSAP_CDN}"></script>
        <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      window.__timelines["${chapterId}"] = tl;
        </script>
      </div>
    </template>`
}

// --- Clip rendering (mirrors template.ts logic for the subset of shots in a chapter) ---

function renderClips(m: VideoModel): string {
  return m.scenes.map((scene, i) => renderSceneClip(m, scene, i)).join("\n\n")
}

function renderSceneClip(m: VideoModel, scene: Scene, index: number): string {
  const sid = `s${index}`
  const inner = renderShotInner(m, scene, sid)
  return `        <div id="${sid}" class="clip ${clipClass(scene.kind)}" data-start="${round(scene.start)}" data-duration="${round(scene.duration)}" data-track-index="1">
${inner}
        </div>`
}

function clipClass(kind: ShotType): string {
  const map: Record<ShotType, string> = {
    "brand-center": "sc-brand-center",
    "brand-side": "sc-brand-side",
    "hero-split": "sc-hero-split",
    "hero-stack": "sc-hero-stack",
    "shot-window": "sc-window",
    "shot-tilt": "sc-tilt",
    "shot-zoom": "sc-zoom",
    "shot-split": "sc-split",
    "feature-row": "sc-frow",
    "feature-stack": "sc-fstack",
    "data-counter": "sc-data",
    "chips-marquee": "sc-marquee",
    "logo-wall": "sc-logos",
    "pricing": "sc-pricing",
    "cta-push": "sc-cta-push",
    "cta-fullbleed": "sc-cta-full",
  }
  return map[kind] || "sc-window"
}

function renderShotInner(m: VideoModel, scene: Scene, _sid: string): string {
  const shot = scene.shots?.[0] || { src: "", caption: "", tall: true }
  const shotB = scene.shots?.[1] || shot

  switch (scene.kind) {
    case "brand-center":
      return `          <div class="brand">${esc(m.brand.title)}</div>
          <div class="rule"></div>
          ${m.brand.tagline ? `<div class="brand-sub">${esc(m.brand.tagline)}</div>` : ""}`
    case "brand-side":
      return `          <div class="bs-bar"></div>
          <div class="bs-text">
            <div class="brand">${esc(m.brand.title)}</div>
            ${m.brand.tagline ? `<div class="brand-sub">${esc(m.brand.tagline)}</div>` : ""}
          </div>`
    case "hero-split": {
      const buttons = m.hero.ctas.map((c, i) => `<span class="btn ${i === 0 ? "btn-primary" : "btn-outline"}">${esc(c)}</span>`).join("\n            ")
      const chips = m.hero.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("\n          ")
      const featureCards = m.valueProps.slice(0, 3).map((p) => `            <div class="hero-feat-card">
              <div class="hfc-title">${esc(p.title)}</div>
              <div class="hfc-desc">${esc(p.desc)}</div>
            </div>`).join("\n")
      return `          <div class="hero-navbar">
            <div class="hnb-logo">${esc(m.brand.title)}</div>
            <div class="hnb-links">
              <span>Features</span><span>Pricing</span><span>Docs</span><span>Blog</span>
            </div>
          </div>
          <div class="hero-col">
            <div class="h1">${esc(m.hero.headline)}</div>
            ${m.hero.lede ? `<div class="lede">${esc(m.hero.lede)}</div>` : ""}
            <div class="hero-search-bar">
              <span class="hsb-icon">&#x1F50D;</span>
              <span class="hsb-placeholder">Ask anything...</span>
            </div>
            ${buttons ? `<div class="btn-row">\n            ${buttons}\n          </div>` : ""}
          </div>
          ${featureCards ? `<div class="hero-feat-grid">\n${featureCards}\n          </div>` : ""}
          ${chips ? `<div class="chips">\n          ${chips}\n        </div>` : `<div class="chips"></div>`}`
    }
    case "hero-stack": {
      const buttons = m.hero.ctas.map((c, i) => `<span class="btn ${i === 0 ? "btn-primary" : "btn-outline"}">${esc(c)}</span>`).join("\n            ")
      const featureCards = m.valueProps.slice(0, 3).map((p) => `            <div class="hero-feat-card">
              <div class="hfc-title">${esc(p.title)}</div>
              <div class="hfc-desc">${esc(p.desc)}</div>
            </div>`).join("\n")
      return `          <div class="hero-navbar hero-navbar--center">
            <div class="hnb-logo">${esc(m.brand.title)}</div>
            <div class="hnb-links">
              <span>Features</span><span>Pricing</span><span>Docs</span>
            </div>
          </div>
          <div class="h1 center">${esc(m.hero.headline)}</div>
          ${m.hero.lede ? `<div class="lede center">${esc(m.hero.lede)}</div>` : ""}
          <div class="hero-search-bar hero-search-bar--center">
            <span class="hsb-icon">&#x1F50D;</span>
            <span class="hsb-placeholder">Ask anything...</span>
          </div>
          ${buttons ? `<div class="btn-row center">\n          ${buttons}\n        </div>` : ""}
          ${featureCards ? `<div class="hero-feat-grid hero-feat-grid--center">\n${featureCards}\n          </div>` : ""}`
    }
    case "shot-window":
      return `          <div class="window">
            <div class="viewport">
              <img class="shot shot-visual" src="${esc(shot.src)}" alt="${esc(shot.caption)}" data-layout-allow-overflow />
            </div>
          </div>
          <div class="cap">${esc(shot.caption)}</div>`
    case "shot-tilt":
      return `          <div class="tilt-stage">
            <div class="tilt-card" data-layout-allow-overflow>
              <img class="tilt-img" src="${esc(shot.src)}" alt="${esc(shot.caption)}" data-layout-allow-overflow />
            </div>
          </div>
          <div class="cap">${esc(shot.caption)}</div>`
    case "shot-zoom":
      return `          <div class="window">
            <div class="viewport">
              <img class="zoom-img shot-visual" src="${esc(shot.src)}" alt="${esc(shot.caption)}" data-layout-allow-overflow />
            </div>
          </div>
          <div class="cap">${esc(shot.caption)}</div>`
    case "shot-split":
      return `          <div class="split-grid">
            <div class="sp-pane sp-a">
              <span class="sp-badge">Before</span>
              <img class="sp-img" src="${esc(shot.src)}" alt="${esc(shot.caption)}" data-layout-allow-overflow />
            </div>
            <div class="sp-pane sp-b">
              <span class="sp-badge">After</span>
              <img class="sp-img" src="${esc(shotB.src)}" alt="${esc(shotB.caption)}" data-layout-allow-overflow />
            </div>
          </div>`
    case "feature-row": {
      const cards = m.valueProps.map((p, i) => `          <div class="vcard">
            <div class="vnum mono">${String(i + 1).padStart(2, "0")}</div>
            <div class="vtitle">${esc(p.title)}</div>
            <div class="vdesc">${esc(p.desc)}</div>
          </div>`).join("\n")
      return cards
    }
    case "feature-stack": {
      const rows = m.valueProps.map((p, i) => `          <div class="frow">
            <div class="fnum mono">${String(i + 1).padStart(2, "0")}</div>
            <div class="fbody">
              <div class="ftitle">${esc(p.title)}</div>
              <div class="fdesc">${esc(p.desc)}</div>
            </div>
          </div>`).join("\n")
      return rows
    }
    case "data-counter": {
      const cards = (scene.stats || []).map((s, i) => `          <div class="dcard">
            <div class="dval mono" data-idx="${i}">0</div>
            <div class="dlabel">${esc(s.label)}</div>
          </div>`).join("\n")
      return cards
    }
    case "chips-marquee": {
      const chips = m.hero.chips.length ? m.hero.chips : m.valueProps.map((p) => p.title)
      const one = chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("\n            ")
      return `          <div class="mq-track" data-layout-allow-overflow>
            ${one}
            ${one}
          </div>`
    }
    case "logo-wall": {
      const cells = m.logos.map((l) => `          <div class="logo-cell">${esc(l)}</div>`).join("\n")
      return `          <div class="logos-title">Trusted by</div>
          <div class="logo-grid">
${cells}
          </div>`
    }
    case "pricing": {
      const cards = m.pricing.map((p, i) => `          <div class="price-card${i === 1 ? " price-featured" : ""}">
            <div class="price-name">${esc(p.name)}</div>
            <div class="price-val mono">${esc(p.price)}</div>
          </div>`).join("\n")
      return cards
    }
    case "cta-push":
      return `          <div class="cta-h">${esc(m.cta.headline)}</div>
          ${m.cta.command ? `<div class="cmd mono"><span class="p">↗</span> ${esc(m.cta.command)}</div>` : ""}`
    case "cta-fullbleed":
      return `          <div class="cta-h">${esc(m.cta.headline)}</div>
          ${m.cta.command ? `<div class="cmd mono"><span class="p">↗</span> ${esc(m.cta.command)}</div>` : ""}`
    default:
      return ""
  }
}

// --- Timeline rendering (mirrors buildTimeline from template.ts for a sub-model) ---

function renderTimeline(m: VideoModel): string {
  const lines: string[] = []
  const trans = m.skin.motion.transition
  const enterEase = m.skin.motion.enter

  m.scenes.forEach((scene, index) => {
    const sel = `#s${index}`
    const start = round(scene.start)
    const at = (d: number) => round(start + d)

    // Shot-specific tweens (simplified but functional versions)
    switch (scene.kind) {
      case "brand-center":
        lines.push(`      tl.from("${sel} .brand", { opacity: 0, y: 42, scale: 0.96, duration: 1, ease: "${enterEase}" }, ${at(0.2)});`)
        lines.push(`      tl.fromTo("${sel} .rule", { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: "power2.inOut" }, ${at(1.0)});`)
        if (m.brand.tagline) lines.push(`      tl.from("${sel} .brand-sub", { opacity: 0, y: 18, duration: 0.8, ease: "power2.out" }, ${at(1.4)});`)
        break
      case "brand-side":
        lines.push(`      tl.fromTo("${sel} .bs-bar", { scaleY: 0 }, { scaleY: 1, duration: 0.8, ease: "power2.inOut" }, ${at(0.2)});`)
        lines.push(`      tl.from("${sel} .brand", { opacity: 0, x: 60, duration: 0.9, ease: "power3.out" }, ${at(0.5)});`)
        break
      case "hero-split":
      case "hero-stack":
        lines.push(`      tl.from("${sel} .hero-navbar", { opacity: 0, y: -30, duration: 0.6, ease: "power2.out" }, ${at(0.1)});`)
        lines.push(`      tl.from("${sel} .h1", { opacity: 0, y: 50, duration: 0.9, ease: "${enterEase}" }, ${at(0.3)});`)
        if (m.hero.lede) lines.push(`      tl.from("${sel} .lede", { opacity: 0, y: 30, duration: 0.8, ease: "power2.out" }, ${at(0.7)});`)
        lines.push(`      tl.from("${sel} .hero-search-bar", { opacity: 0, y: 24, scale: 0.96, duration: 0.7, ease: "power2.out" }, ${at(1.0)});`)
        if (m.hero.ctas.length) lines.push(`      tl.from("${sel} .btn", { opacity: 0, y: 24, duration: 0.6, stagger: 0.12, ease: "back.out(1.6)" }, ${at(1.4)});`)
        lines.push(`      tl.from("${sel} .hero-feat-card", { opacity: 0, y: 30, duration: 0.6, stagger: 0.1, ease: "power3.out" }, ${at(1.8)});`)
        break
      case "shot-window": {
        // PageCam 2.5D 相机动画
        const camPresetW = presetForShot("shot-window")
        const camDurW = Math.max(2, round(scene.duration - 1.2))
        const keysW = getPreset(camPresetW, camDurW)
        const easeW = m.motionProfile?.enterEase || "power2.inOut"
        const camW = buildPageCamAnimation(keysW, `${sel} .shot`, easeW)
        lines.push(`      tl.from("${sel} .window", { opacity: 0, y: 56, scale: 0.96, duration: 0.9, ease: "power3.out" }, ${at(0.2)});`)
        lines.push(`      tl.from("${sel} .shot-visual", { opacity: 0, duration: 0.6, ease: "power2.out" }, ${at(0.5)});`)
        lines.push(`      tl.from("${sel} .cap", { opacity: 0, y: 20, duration: 0.7, ease: "power2.out" }, ${at(0.8)});`)
        lines.push(camW.gsap)
        break
      }
      case "shot-tilt": {
        // PageCam 2.5D 相机动画：tilt-to-front 预设
        const camPresetT = presetForShot("shot-tilt")
        const camDurT = Math.max(2, round(scene.duration - 1.6))
        const keysT = getPreset(camPresetT, camDurT)
        const easeT = m.motionProfile?.enterEase || "power2.inOut"
        const camT = buildPageCamAnimation(keysT, `${sel} .tilt-img`, easeT)
        lines.push(`      tl.from("${sel} .tilt-card", { opacity: 0, rotationY: -22, rotationX: 8, y: 70, transformPerspective: 1600, duration: 1.1, ease: "power3.out" }, ${at(0.2)});`)
        lines.push(`      tl.from("${sel} .tilt-img", { opacity: 0, duration: 0.6, ease: "power2.out" }, ${at(0.5)});`)
        lines.push(camT.gsap)
        break
      }
      case "shot-zoom": {
        // PageCam 2.5D 相机动画：slow-zoom 预设
        const camPresetZ = presetForShot("shot-zoom")
        const camDurZ = Math.max(2, round(scene.duration - 1.0))
        const keysZ = getPreset(camPresetZ, camDurZ)
        const easeZ = m.motionProfile?.enterEase || "power2.inOut"
        const camZ = buildPageCamAnimation(keysZ, `${sel} .zoom-img`, easeZ)
        lines.push(`      tl.from("${sel} .window", { opacity: 0, scale: 0.94, duration: 0.9, ease: "power3.out" }, ${at(0.2)});`)
        lines.push(`      tl.from("${sel} .shot-visual", { opacity: 0, duration: 0.6, ease: "power2.out" }, ${at(0.5)});`)
        lines.push(camZ.gsap)
        break
      }
      case "shot-split":
        lines.push(`      tl.from("${sel} .sp-a", { opacity: 0, x: -110, duration: 0.85, ease: "power3.out" }, ${at(0.2)});`)
        lines.push(`      tl.from("${sel} .sp-b", { opacity: 0, x: 110, duration: 0.85, ease: "power3.out" }, ${at(0.5)});`)
        break
      case "feature-row":
        lines.push(`      tl.from("${sel} .vcard", { opacity: 0, y: 50, duration: 0.7, stagger: 0.15, ease: "power3.out" }, ${at(0.2)});`)
        break
      case "feature-stack":
        lines.push(`      tl.from("${sel} .frow", { opacity: 0, x: -70, duration: 0.7, stagger: 0.16, ease: "power3.out" }, ${at(0.2)});`)
        break
      case "data-counter":
        lines.push(`      tl.from("${sel} .dcard", { opacity: 0, y: 46, scale: 0.95, duration: 0.7, stagger: 0.14, ease: "power3.out" }, ${at(0.2)});`)
        break
      case "chips-marquee":
        lines.push(`      tl.from("${sel} .chip", { opacity: 0, y: 24, scale: 0.9, duration: 0.5, stagger: 0.05, ease: "back.out(1.7)" }, ${at(0.1)});`)
        break
      case "logo-wall":
        lines.push(`      tl.from("${sel} .logos-title", { opacity: 0, y: 30, duration: 0.7, ease: "${enterEase}" }, ${at(0.2)});`)
        lines.push(`      tl.from("${sel} .logo-cell", { opacity: 0, y: 34, scale: 0.9, duration: 0.6, stagger: 0.08, ease: "back.out(1.6)" }, ${at(0.6)});`)
        break
      case "pricing":
        lines.push(`      tl.from("${sel} .price-card", { opacity: 0, y: 48, scale: 0.95, duration: 0.7, stagger: 0.14, ease: "power3.out" }, ${at(0.2)});`)
        break
      case "cta-push":
        lines.push(`      tl.from("${sel} .cta-h", { opacity: 0, y: 44, duration: 0.7, ease: "${enterEase}" }, ${at(0.2)});`)
        if (m.cta.command) lines.push(`      tl.from("${sel} .cmd", { opacity: 0, y: 24, duration: 0.6, ease: "back.out(1.6)" }, ${at(0.6)});`)
        break
      case "cta-fullbleed":
        lines.push(`      tl.set("${sel}", { opacity: 0 }, 0);`)
        lines.push(`      tl.to("${sel}", { opacity: 1, duration: 0.5, ease: "power1.out" }, ${at(0)});`)
        lines.push(`      tl.from("${sel} .cta-h", { opacity: 0, y: 48, scale: 0.96, duration: 0.8, ease: "${enterEase}" }, ${at(0.25)});`)
        break
    }

    // Cross-chapter transition effects
    if (trans === "crossfade" && index > 0) {
      lines.push(`      tl.from("${sel}", { opacity: 0, duration: 0.6, ease: "power1.inOut" }, ${start});`)
    }
    if (trans === "flash" && index > 0) {
      lines.push(`      tl.to(".fx-flash", { opacity: 0.92, duration: 0.09, ease: "power1.in" }, ${round(start - 0.09)});`)
      lines.push(`      tl.to(".fx-flash", { opacity: 0, duration: 0.2, ease: "power1.out" }, ${start});`)
    }
  })

  return lines.join("\n")
}

// --- CSS rendering (subset of buildCss from template.ts) ---

function renderCss(m: VideoModel): string {
  const p = m.palette
  return `      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: ${p.bg}; }
      :root {
        --fg: ${p.fg}; --bg: ${p.bg}; --accent: ${p.accent}; --accent-fg: ${p.accentFg};
        --muted: ${p.muted}; --secondary: ${p.secondary}; --border: ${p.border}; --radius: 10px;
      }
      body { font-family: ${p.fontFamily}; color: var(--fg); -webkit-font-smoothing: antialiased; }
      .clip { position: absolute; inset: 0; }
      .mono { font-family: "JetBrains Mono", ui-monospace, monospace; }
      .fx-flash { position: absolute; inset: 0; background: #ffffff; opacity: 0; pointer-events: none; z-index: 90; }

      /* Brand */
      .sc-brand-center { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; }
      .brand { font-size: 150px; font-weight: 800; letter-spacing: -0.05em; text-align: center; padding: 0 80px; overflow-wrap: break-word; }
      .rule { width: 360px; height: 3px; background: var(--accent); transform-origin: center; }
      .brand-sub { font-size: 30px; color: var(--muted); text-align: center; padding: 0 120px; }
      .sc-brand-side { display: flex; align-items: center; gap: 56px; padding: 0 180px; }
      .sc-brand-side .bs-bar { width: 12px; height: 460px; background: var(--accent); border-radius: 6px; transform-origin: top; }
      .sc-brand-side .brand { font-size: 130px; text-align: left; padding: 0; }

      /* Hero */
      .sc-hero-split { display: grid; grid-template-columns: 1.1fr 0.9fr; align-items: center; padding: 0 140px; gap: 80px; }
      .sc-hero-stack { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 200px; text-align: center; }
      .hero-navbar { display: flex; align-items: center; justify-content: space-between; padding: 0 140px; margin-bottom: 24px; }
      .hero-navbar--center { justify-content: center; gap: 48px; }
      .hnb-logo { font-size: 28px; font-weight: 800; letter-spacing: -0.03em; color: var(--accent); }
      .hnb-links { display: flex; gap: 32px; font-size: 20px; color: var(--muted); }
      .hnb-links span { cursor: default; }
      .hero-search-bar { display: flex; align-items: center; gap: 14px; padding: 18px 28px; border: 1px solid var(--border); border-radius: 16px; background: var(--secondary); margin-top: 28px; max-width: 560px; }
      .hero-search-bar--center { margin-left: auto; margin-right: auto; }
      .hsb-icon { font-size: 24px; opacity: 0.6; }
      .hsb-placeholder { font-size: 22px; color: var(--muted); }
      .hero-feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 28px; }
      .hero-feat-grid--center { max-width: 900px; margin-left: auto; margin-right: auto; }
      .hero-feat-card { border: 1px solid var(--border); border-radius: 14px; padding: 24px; background: var(--secondary); }
      .hfc-title { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
      .hfc-desc { font-size: 16px; color: var(--muted); line-height: 1.4; }
      .h1 { font-size: 84px; font-weight: 800; line-height: 1.03; letter-spacing: -0.04em; max-width: 780px; overflow-wrap: break-word; }
      .h1.center { max-width: 1300px; }
      .lede { font-size: 30px; color: var(--muted); line-height: 1.5; margin-top: 32px; max-width: 680px; }
      .lede.center { max-width: 1000px; }
      .btn-row { display: flex; gap: 20px; margin-top: 48px; }
      .btn-row.center { justify-content: center; }
      .btn { display: inline-flex; align-items: center; height: 64px; padding: 0 34px; border-radius: var(--radius); font-size: 24px; font-weight: 500; }
      .btn-primary { background: var(--accent); color: var(--accent-fg); }
      .btn-outline { background: var(--bg); color: var(--fg); border: 1px solid var(--border); }
      .chips { display: flex; flex-wrap: wrap; gap: 18px; align-content: center; }
      .chip { display: inline-flex; align-items: center; height: 60px; padding: 0 28px; border-radius: var(--radius); font-size: 22px; font-weight: 500; border: 1px solid var(--border); background: var(--bg); }

      /* Screenshots */
      .sc-window, .sc-zoom { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 40px; }
      .window { width: 1180px; border-radius: 16px; overflow: hidden; background: var(--bg); box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 8px 40px rgba(0,0,0,0.3); }
      .viewport { width: 100%; height: 692px; overflow: hidden; position: relative; background: var(--secondary); }
      .viewport img, .shot, .zoom-img, .shot-visual { width: 100%; height: 100%; object-fit: cover; object-position: top center; display: block; transform-origin: center center; will-change: transform; }
      .cap { font-size: clamp(24px, 2.4vw, 34px); font-weight: 500; text-align: center; padding: 0 160px; max-width: 1520px; margin-left: auto; margin-right: auto; line-height: 1.28; }
      .sc-tilt { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 44px; }
      .tilt-stage { perspective: 1600px; }
      .tilt-card { width: 1200px; height: 675px; border-radius: 16px; overflow: hidden; box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 8px 40px rgba(0,0,0,0.3); background: var(--secondary); }
      .tilt-img { width: 100%; height: 100%; object-fit: cover; display: block; transform-origin: center center; will-change: transform; }
      .sc-split { display: flex; align-items: center; justify-content: center; padding: 0 90px; }
      .split-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; width: 100%; }
      .sp-pane { position: relative; height: 720px; border-radius: 14px; overflow: hidden; box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 8px 40px rgba(0,0,0,0.3); background: var(--secondary); }
      .sp-img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .sp-badge { position: absolute; top: 22px; left: 22px; z-index: 2; height: 46px; padding: 0 22px; display: inline-flex; align-items: center; border-radius: 999px; font-size: 22px; font-weight: 600; background: var(--accent); color: var(--accent-fg); }

      /* Features */
      .sc-frow { display: flex; align-items: center; justify-content: center; gap: 44px; padding: 0 120px; }
      .vcard { width: 480px; height: 440px; border: 1px solid var(--border); border-radius: 20px; padding: 52px; display: flex; flex-direction: column; }
      .vnum { font-size: 26px; color: var(--muted); }
      .vtitle { font-size: 54px; font-weight: 800; letter-spacing: -0.03em; margin-top: 20px; }
      .vdesc { font-size: 26px; color: var(--muted); line-height: 1.5; margin-top: auto; }
      .sc-fstack { display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: 36px; padding: 0 320px; }
      .frow { display: flex; align-items: flex-start; gap: 40px; border-bottom: 1px solid var(--border); padding-bottom: 32px; }
      .frow:last-child { border-bottom: none; }
      .fnum { font-size: 40px; color: var(--accent); font-weight: 700; min-width: 90px; }
      .ftitle { font-size: 52px; font-weight: 800; letter-spacing: -0.03em; }
      .fdesc { font-size: 26px; color: var(--muted); line-height: 1.5; margin-top: 12px; }

      /* Data */
      .sc-data { display: flex; align-items: center; justify-content: center; gap: 60px; padding: 0 120px; }
      .dcard { display: flex; flex-direction: column; align-items: center; gap: 18px; min-width: 360px; }
      .dval { font-size: 150px; font-weight: 800; letter-spacing: -0.04em; color: var(--accent); font-variant-numeric: tabular-nums; }
      .dlabel { font-size: 30px; color: var(--muted); text-align: center; }

      /* Marquee */
      .sc-marquee { display: flex; align-items: center; justify-content: flex-start; }
      .mq-track { display: flex; gap: 24px; padding: 0 100px; white-space: nowrap; }
      .sc-marquee .chip { height: 84px; font-size: 34px; padding: 0 40px; }

      /* Logos */
      .sc-logos { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 56px; padding: 0 160px; }
      .logos-title { font-size: 44px; font-weight: 700; color: var(--muted); text-align: center; }
      .logo-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px; width: 100%; max-width: 1440px; }
      .logo-cell { height: 130px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: var(--radius); background: var(--secondary); font-size: 32px; font-weight: 700; }

      /* Pricing */
      .sc-pricing { display: flex; align-items: center; justify-content: center; gap: 40px; padding: 0 120px; }
      .price-card { width: 380px; min-height: 420px; border: 1px solid var(--border); border-radius: 20px; padding: 52px 44px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; background: var(--bg); }
      .price-featured { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); transform: scale(1.06); }
      .price-name { font-size: 40px; font-weight: 700; text-align: center; }
      .price-val { font-size: 72px; font-weight: 800; letter-spacing: -0.03em; }

      /* CTA */
      .sc-cta-push { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 40px; }
      .sc-cta-full { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 40px; background: var(--accent); color: var(--accent-fg); }
      .cta-h { font-size: 96px; font-weight: 800; letter-spacing: -0.04em; text-align: center; padding: 0 80px; max-width: 1640px; overflow-wrap: break-word; }
      .sc-cta-push .cmd { display: inline-flex; align-items: center; gap: 16px; height: 84px; padding: 0 40px; background: var(--secondary); border: 1px solid var(--border); border-radius: 14px; font-size: 34px; color: var(--fg); }
      .sc-cta-full .cmd { display: inline-flex; align-items: center; gap: 16px; height: 84px; padding: 0 40px; background: transparent; border: 1px solid var(--accent-fg); border-radius: 14px; font-size: 34px; color: var(--accent-fg); }`
}
