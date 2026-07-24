// VideoModel → index.html。方案 B 的模板层，现改为「镜头配方库」：
// 一组独立的 shot 类型，每种 = 一段 HTML + 一段 GSAP 时间线片段 + 对应 CSS。
// 故事板（model.ts 的 selectStoryboard）决定用哪些镜头、什么顺序、各多长；
// 本文件只负责把每个镜头渲染出来。所有动画只用 transform/opacity（防抖动，GPU 合成，
// 不触发 reflow），文字对 bg 恒达 AA（accent 上的文字统一用 accentFg），保证 hyperframes check 通过。
import type { ChapterId } from "./chapters/types"
import type { Scene, ShotMaterial, ShotType, VideoModel } from "./model"
import { buildPageCamAnimation, getPreset, presetForShot } from "./chapters/page-cam"

const GSAP_CDN = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"

/** HTML 文本转义 */
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

/** 皮肤运镜签名：主入场缓动(editorial=power2.out 缓 / kinetic=expo.out 快 / technical=power4.out 硬)
 *  优先使用 MotionProfile 的 enterEase（品牌动效推导），否则回落皮肤默认。 */
function enterEase(m: VideoModel): string {
  return m.motionProfile?.enterEase || m.skin.motion.enter
}

/** 获取 MotionProfile 的 stagger 间隔，无则回落默认值 */
function mpStagger(m: VideoModel, fallback: number = 0.12): number {
  return m.motionProfile?.stagger ?? fallback
}

/** 获取 MotionProfile 的 overshoot，用于 back.out 缓动参数 */
function mpOvershoot(m: VideoModel): number {
  return m.motionProfile?.overshoot ?? 0
}

/** 生成带 overshoot 的 back.out ease 字符串 */
function backEase(m: VideoModel, defaultStrength: number = 1.6): string {
  const os = mpOvershoot(m)
  if (os > 0) return `back.out(${(1 + os).toFixed(1)})`
  return `back.out(${defaultStrength})`
}

/** 获取 MotionProfile 的入场时长，无则回落默认值 */
function mpEnterDur(m: VideoModel, fallback: number = 0.9): number {
  return m.motionProfile?.enterDuration ?? fallback
}

/** 解析有效转场类型：MotionProfile 优先，否则回落皮肤默认 */
function effectiveTransition(m: VideoModel): string {
  return m.motionProfile?.transition || m.skin.motion.transition
}

/** 一个镜头的产物：HTML 片段（clip 外壳，含占位 data-start/duration） */
type ShotRender = (m: VideoModel, sid: string, scene: Scene) => string
/** 一个镜头的时间线片段：t 为该镜头在总时间线上的绝对起点（秒） */
type ShotTimeline = (m: VideoModel, sel: string, scene: Scene, t: number) => string[]

interface ShotDef {
  render: ShotRender
  timeline: ShotTimeline
}

/** 统一 clip 外壳（占位 start/duration 由 renderScene 注入真实值）
 *  内含四层深度结构：depth-bg / depth-mid / depth-content / depth-fg */
function clip(sid: string, cls: string, inner: string, extraAttr = ""): string {
  return `      <div id="${sid}" class="clip ${cls}" data-start="0" data-duration="1" data-track-index="1"${extraAttr ? " " + extraAttr : ""}>
        <div class="depth-bg"></div>
        <div class="depth-mid"></div>
        <div class="depth-content">
${inner}
        </div>
        <div class="depth-fg">
          <div class="geo geo-1"></div>
          <div class="geo geo-2"></div>
          <div class="geo geo-3"></div>
        </div>
      </div>`
}

// ============================================================
// 开场品牌镜头
// ============================================================

const brandCenter: ShotDef = {
  render: (m, sid) =>
    clip(
      sid,
      "sc-brand-center",
      `        <div class="brand">${esc(m.brand.title)}</div>
        <div class="rule"></div>
        ${m.brand.tagline ? `<div class="brand-sub">${esc(m.brand.tagline)}</div>` : ""}`
    ),
  timeline: (m, sel, _s, t) => {
    const at = (d: number) => round(t + d)
    const dur = mpEnterDur(m, 1)
    const l = [
      `      tl.from("${sel} .brand", { opacity: 0, y: 42, scale: 0.96, duration: ${dur}, ease: "${enterEase(m)}" }, ${at(0.2)});`,
      `      tl.fromTo("${sel} .rule", { scaleX: 0 }, { scaleX: 1, duration: ${round(dur * 0.9)}, ease: "power2.inOut" }, ${at(0.2 + dur * 0.8)});`,
    ]
    if (m.brand.tagline)
      l.push(`      tl.from("${sel} .brand-sub", { opacity: 0, y: 18, duration: ${round(dur * 0.8)}, ease: "power2.out" }, ${at(0.2 + dur * 1.2)});`)
    return l
  },
}

const brandSide: ShotDef = {
  render: (m, sid) =>
    clip(
      sid,
      "sc-brand-side",
      `        <div class="bs-bar"></div>
        <div class="bs-text">
          <div class="brand">${esc(m.brand.title)}</div>
          ${m.brand.tagline ? `<div class="brand-sub">${esc(m.brand.tagline)}</div>` : ""}
        </div>`
    ),
  timeline: (m, sel, _s, t) => {
    const at = (d: number) => round(t + d)
    const dur = mpEnterDur(m, 0.9)
    const l = [
      `      tl.fromTo("${sel} .bs-bar", { scaleY: 0 }, { scaleY: 1, duration: ${round(dur * 0.88)}, ease: "power2.inOut" }, ${at(0.2)});`,
      `      tl.from("${sel} .brand", { opacity: 0, x: 60, duration: ${dur}, ease: "${enterEase(m)}" }, ${at(0.5)});`,
    ]
    if (m.brand.tagline)
      l.push(`      tl.from("${sel} .brand-sub", { opacity: 0, x: 40, duration: ${round(dur * 0.88)}, ease: "power2.out" }, ${at(0.9)});`)
    return l
  },
}

// ============================================================
// 英雄镜头
// ============================================================

function heroButtons(m: VideoModel): string {
  return m.hero.ctas
    .map((c, i) => `<span class="btn ${i === 0 ? "btn-primary" : "btn-outline"}">${esc(c)}</span>`)
    .join("\n            ")
}

const heroSplit: ShotDef = {
  render: (m, sid) => {
    const buttons = heroButtons(m)
    const chips = m.hero.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("\n          ")
    return clip(
      sid,
      "sc-hero-split",
      `        <div class="hero-col">
          <div class="h1">${esc(m.hero.headline)}</div>
          ${m.hero.lede ? `<div class="lede">${esc(m.hero.lede)}</div>` : ""}
          ${buttons ? `<div class="btn-row">\n            ${buttons}\n          </div>` : ""}
        </div>
        ${chips ? `<div class="chips">\n          ${chips}\n        </div>` : `<div class="chips"></div>`}`
    )
  },
  timeline: (m, sel, _s, t) => {
    const at = (d: number) => round(t + d)
    const dur = mpEnterDur(m, 0.9)
    const stag = mpStagger(m, 0.12)
    const l = [`      tl.from("${sel} .h1", { opacity: 0, y: 50, duration: ${dur}, ease: "${enterEase(m)}" }, ${at(0.2)});`]
    if (m.hero.lede) l.push(`      tl.from("${sel} .lede", { opacity: 0, y: 30, duration: ${round(dur * 0.88)}, ease: "power2.out" }, ${at(0.6)});`)
    if (m.hero.ctas.length)
      l.push(`      tl.from("${sel} .btn", { opacity: 0, y: 24, duration: ${round(dur * 0.66)}, stagger: ${stag}, ease: "${backEase(m, 1.6)}" }, ${at(1.1)});`)
    if (m.hero.chips.length)
      l.push(`      tl.from("${sel} .chip", { opacity: 0, y: 30, scale: 0.9, duration: ${round(dur * 0.6)}, stagger: ${round(stag * 0.85)}, ease: "${backEase(m, 1.7)}" }, ${at(1.0)});`)
    return l
  },
}

const heroStack: ShotDef = {
  render: (m, sid) => {
    const buttons = heroButtons(m)
    return clip(
      sid,
      "sc-hero-stack",
      `        <div class="h1 center">${esc(m.hero.headline)}</div>
        ${m.hero.lede ? `<div class="lede center">${esc(m.hero.lede)}</div>` : ""}
        ${buttons ? `<div class="btn-row center">\n          ${buttons}\n        </div>` : ""}`
    )
  },
  timeline: (m, sel, _s, t) => {
    const at = (d: number) => round(t + d)
    const dur = mpEnterDur(m, 0.9)
    const stag = mpStagger(m, 0.12)
    const l = [`      tl.from("${sel} .h1", { opacity: 0, y: 56, duration: ${dur}, ease: "${enterEase(m)}" }, ${at(0.2)});`]
    if (m.hero.lede) l.push(`      tl.from("${sel} .lede", { opacity: 0, y: 30, duration: ${round(dur * 0.88)}, ease: "power2.out" }, ${at(0.6)});`)
    if (m.hero.ctas.length)
      l.push(`      tl.from("${sel} .btn", { opacity: 0, y: 26, scale: 0.94, duration: ${round(dur * 0.66)}, stagger: ${stag}, ease: "${backEase(m, 1.6)}" }, ${at(1.0)});`)
    return l
  },
}

// ============================================================
// 截图镜头
// ============================================================

function firstShot(scene: Scene): ShotMaterial {
  return scene.shots?.[0] || { src: "", caption: "", tall: true }
}

function windowChrome(_m: VideoModel, shot: ShotMaterial, imgCls: string): string {
  return `        <div class="window">
          <div class="viewport">
            <img class="${imgCls} shot-visual" src="${esc(shot.src)}" alt="${esc(shot.caption)}" data-layout-allow-overflow />
          </div>
        </div>`
}

const shotWindow: ShotDef = {
  render: (m, sid, scene) => {
    const shot = firstShot(scene)
    return clip(sid, "sc-window", `${windowChrome(m, shot, "shot")}\n        <div class="cap">${esc(shot.caption)}</div>`)
  },
  timeline: (m, sel, scene, t) => {
    const at = (d: number) => round(t + d)
    // PageCam 2.5D 相机替代简单 scale 推拉
    const presetName = presetForShot("shot-window")
    const camDur = Math.max(2, round(scene.duration - 1.2))
    const keys = getPreset(presetName, camDur)
    const ease = m.motionProfile?.enterEase || "power2.inOut"
    const cam = buildPageCamAnimation(keys, `${sel} .shot`, ease)
    return [
      `      tl.from("${sel} .window", { opacity: 0, y: 56, scale: 0.96, duration: ${mpEnterDur(m, 0.9)}, ease: "${enterEase(m)}" }, ${at(0.2)});`,
      `      tl.from("${sel} .shot-visual", { opacity: 0, duration: 0.6, ease: "power2.out" }, ${at(0.5)});`,
      `      tl.from("${sel} .cap", { opacity: 0, y: 20, duration: 0.7, ease: "power2.out" }, ${at(0.8)});`,
      cam.css,
      cam.gsap,
    ]
  },
}

const shotTilt: ShotDef = {
  render: (_m, sid, scene) => {
    const shot = firstShot(scene)
    return clip(
      sid,
      "sc-tilt",
      `        <div class="tilt-stage">
          <div class="tilt-card" data-layout-allow-overflow>
            <img class="tilt-img" src="${esc(shot.src)}" alt="${esc(shot.caption)}" data-layout-allow-overflow />
          </div>
        </div>
        <div class="cap">${esc(shot.caption)}</div>`
    )
  },
  timeline: (m, sel, scene, t) => {
    const at = (d: number) => round(t + d)
    // PageCam 2.5D 相机：tilt-to-front 预设，3D 倾斜入场 → 正面
    const presetName = presetForShot("shot-tilt")
    const camDur = Math.max(2, round(scene.duration - 1.6))
    const keys = getPreset(presetName, camDur)
    const ease = m.motionProfile?.enterEase || "power2.inOut"
    const cam = buildPageCamAnimation(keys, `${sel} .tilt-img`, ease)
    return [
      `      tl.from("${sel} .tilt-card", { opacity: 0, rotationY: -22, rotationX: 8, y: 70, transformPerspective: 1600, duration: ${mpEnterDur(m, 1.1)}, ease: "${enterEase(m)}" }, ${at(0.2)});`,
      `      tl.from("${sel} .tilt-img", { opacity: 0, duration: 0.6, ease: "power2.out" }, ${at(0.5)});`,
      `      tl.from("${sel} .cap", { opacity: 0, y: 20, duration: 0.7, ease: "power2.out" }, ${at(0.8)});`,
      cam.css,
      cam.gsap,
    ]
  },
}

const shotZoom: ShotDef = {
  render: (m, sid, scene) => {
    const shot = firstShot(scene)
    return clip(sid, "sc-zoom", `${windowChrome(m, shot, "zoom-img")}\n        <div class="cap">${esc(shot.caption)}</div>`)
  },
  timeline: (m, sel, scene, t) => {
    const at = (d: number) => round(t + d)
    // PageCam 2.5D 相机：slow-zoom 预设，缓慢 zoom in + 微旋转
    const presetName = presetForShot("shot-zoom")
    const camDur = Math.max(2, round(scene.duration - 1.0))
    const keys = getPreset(presetName, camDur)
    const ease = m.motionProfile?.enterEase || "power2.inOut"
    const cam = buildPageCamAnimation(keys, `${sel} .zoom-img`, ease)
    return [
      `      tl.from("${sel} .window", { opacity: 0, scale: 0.94, duration: ${mpEnterDur(m, 0.9)}, ease: "${enterEase(m)}" }, ${at(0.2)});`,
      `      tl.from("${sel} .shot-visual", { opacity: 0, duration: 0.6, ease: "power2.out" }, ${at(0.5)});`,
      `      tl.from("${sel} .cap", { opacity: 0, y: 20, duration: 0.7, ease: "power2.out" }, ${at(0.8)});`,
      cam.css,
      cam.gsap,
    ]
  },
}

const shotSplit: ShotDef = {
  render: (_m, sid, scene) => {
    const a = scene.shots?.[0] || firstShot(scene)
    const b = scene.shots?.[1] || a
    const pane = (s: ShotMaterial, badge: string, side: string) =>
      `          <div class="sp-pane sp-${side}">
            <span class="sp-badge">${badge}</span>
            <img class="sp-img" src="${esc(s.src)}" alt="${esc(s.caption)}" data-layout-allow-overflow />
          </div>`
    return clip(
      sid,
      "sc-split",
      `        <div class="split-grid">
${pane(a, "Before", "a")}
${pane(b, "After", "b")}
        </div>`
    )
  },
  timeline: (m, sel, _s, t) => {
    const at = (d: number) => round(t + d)
    const stag = mpStagger(m, 0.1)
    return [
      `      tl.from("${sel} .sp-a", { opacity: 0, x: -110, duration: ${mpEnterDur(m, 0.85)}, ease: "${enterEase(m)}" }, ${at(0.2)});`,
      `      tl.from("${sel} .sp-b", { opacity: 0, x: 110, duration: ${mpEnterDur(m, 0.85)}, ease: "${enterEase(m)}" }, ${at(0.5)});`,
      `      tl.from("${sel} .sp-badge", { opacity: 0, y: -18, duration: 0.5, stagger: ${stag}, ease: "${backEase(m, 1.7)}" }, ${at(0.9)});`,
    ]
  },
}

// ============================================================
// 特性 / 数据 / 标签镜头
// ============================================================

const featureRow: ShotDef = {
  render: (m, sid) => {
    const cards = m.valueProps
      .map(
        (p, i) => `        <div class="vcard">
          <div class="vnum mono">${String(i + 1).padStart(2, "0")}</div>
          <div class="vtitle">${esc(p.title)}</div>
          <div class="vdesc">${esc(p.desc)}</div>
        </div>`
      )
      .join("\n")
    return clip(sid, "sc-frow", cards)
  },
  timeline: (m, sel, _s, t) => {
    const stag = mpStagger(m, 0.15)
    return [
      `      tl.from("${sel} .vcard", { opacity: 0, y: 50, duration: ${mpEnterDur(m, 0.7)}, stagger: ${stag}, ease: "${enterEase(m)}" }, ${round(t + 0.2)});`,
    ]
  },
}

const featureStack: ShotDef = {
  render: (m, sid) => {
    const rows = m.valueProps
      .map(
        (p, i) => `        <div class="frow">
          <div class="fnum mono">${String(i + 1).padStart(2, "0")}</div>
          <div class="fbody">
            <div class="ftitle">${esc(p.title)}</div>
            <div class="fdesc">${esc(p.desc)}</div>
          </div>
        </div>`
      )
      .join("\n")
    return clip(sid, "sc-fstack", rows)
  },
  timeline: (m, sel, _s, t) => {
    const stag = mpStagger(m, 0.16)
    return [
      `      tl.from("${sel} .frow", { opacity: 0, x: -70, duration: ${mpEnterDur(m, 0.7)}, stagger: ${stag}, ease: "${enterEase(m)}" }, ${round(t + 0.2)});`,
    ]
  },
}

/** 把 "106.8K" / "100%" 拆成数值 + 后缀 + 小数位，供计数动画格式化 */
function parseStatValue(value: string): { num: number; suffix: string; decimals: number } {
  const m = value.match(/^([\d.,]+)\s*(.*)$/)
  if (!m) return { num: 0, suffix: value, decimals: 0 }
  const numRaw = m[1]!.replace(/,/g, "")
  const num = parseFloat(numRaw)
  const dot = numRaw.indexOf(".")
  const decimals = dot >= 0 ? numRaw.length - dot - 1 : 0
  return { num: isFinite(num) ? num : 0, suffix: m[2] || "", decimals }
}

const dataCounter: ShotDef = {
  render: (_m, sid, scene) => {
    const cards = (scene.stats || [])
      .map(
        (s, i) => `        <div class="dcard">
          <div class="dval mono" data-idx="${i}">0</div>
          <div class="dlabel">${esc(s.label)}</div>
        </div>`
      )
      .join("\n")
    return clip(sid, "sc-data", cards)
  },
  timeline: (m, sel, scene, t) => {
    const at = (d: number) => round(t + d)
    const stag = mpStagger(m, 0.14)
    const lines: string[] = [
      `      tl.from("${sel} .dcard", { opacity: 0, y: 46, scale: 0.95, duration: ${mpEnterDur(m, 0.7)}, stagger: ${stag}, ease: "${enterEase(m)}" }, ${at(0.2)});`,
    ]
    ;(scene.stats || []).forEach((s, i) => {
      const { num, suffix, decimals } = parseStatValue(s.value)
      const dur = Math.max(1.2, round(scene.duration - 1.2))
      // 计数动画：只改 textContent（tabular-nums 定宽，不抖动）
      lines.push(
        `      { const _o${i}={v:0}; const _el${i}=document.querySelector("${sel} .dval[data-idx='${i}']"); ` +
          `tl.to(_o${i}, { v: ${num}, duration: ${dur}, ease: "power1.out", onUpdate: function(){ if(_el${i}) _el${i}.textContent = _o${i}.v.toFixed(${decimals}) + ${JSON.stringify(suffix)}; } }, ${at(0.4)}); }`
      )
    })
    return lines
  },
}

const chipsMarquee: ShotDef = {
  render: (m, sid) => {
    const chips = m.hero.chips.length ? m.hero.chips : m.valueProps.map((p) => p.title)
    const one = chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("\n            ")
    // 复制一份让轨道更长，便于横向平移
    return clip(
      sid,
      "sc-marquee",
      `        <div class="mq-track" data-layout-allow-overflow>
            ${one}
            ${one}
        </div>`
    )
  },
  timeline: (m, sel, scene, t) => {
    const at = (d: number) => round(t + d)
    const dur = Math.max(2, round(scene.duration))
    const stag = mpStagger(m, 0.05)
    return [
      `      tl.from("${sel} .chip", { opacity: 0, y: 24, scale: 0.9, duration: 0.5, stagger: ${stag}, ease: "${backEase(m, 1.7)}" }, ${at(0.1)});`,
      `      tl.fromTo("${sel} .mq-track", { x: 0 }, { x: -760, duration: ${dur}, ease: "none" }, ${at(0.2)});`,
    ]
  },
}

// ============================================================
// logo 墙 / 定价镜头（HTML 原生重绘，无截图）
// ============================================================

const logoWall: ShotDef = {
  render: (m, sid) => {
    const cells = m.logos.map((l) => `          <div class="logo-cell">${esc(l)}</div>`).join("\n")
    return clip(
      sid,
      "sc-logos",
      `        <div class="logos-title">Trusted by</div>
        <div class="logo-grid">
${cells}
        </div>`
    )
  },
  timeline: (m, sel, _s, t) => {
    const at = (d: number) => round(t + d)
    const stag = mpStagger(m, 0.08)
    return [
      `      tl.from("${sel} .logos-title", { opacity: 0, y: 30, duration: ${mpEnterDur(m, 0.7)}, ease: "${enterEase(m)}" }, ${at(0.2)});`,
      `      tl.from("${sel} .logo-cell", { opacity: 0, y: 34, scale: 0.9, duration: 0.6, stagger: ${stag}, ease: "${backEase(m, 1.6)}" }, ${at(0.6)});`,
    ]
  },
}

const pricingTable: ShotDef = {
  render: (m, sid) => {
    const cards = m.pricing
      .map(
        (p, i) => `        <div class="price-card${i === 1 ? " price-featured" : ""}">
          <div class="price-name">${esc(p.name)}</div>
          <div class="price-val mono">${esc(p.price)}</div>
        </div>`
      )
      .join("\n")
    return clip(sid, "sc-pricing", cards)
  },
  timeline: (m, sel, _s, t) => {
    const stag = mpStagger(m, 0.14)
    return [
      `      tl.from("${sel} .price-card", { opacity: 0, y: 48, scale: 0.95, duration: ${mpEnterDur(m, 0.7)}, stagger: ${stag}, ease: "${enterEase(m)}" }, ${round(t + 0.2)});`,
    ]
  },
}

// ============================================================
// 结尾 CTA 镜头
// ============================================================

const ctaPush: ShotDef = {
  render: (m, sid) =>
    clip(
      sid,
      "sc-cta-push",
      `        <div class="cta-h">${esc(m.cta.headline)}</div>
        ${m.cta.command ? `<div class="cmd mono"><span class="p">↗</span> ${esc(m.cta.command)}</div>` : ""}`
    ),
  timeline: (m, sel, _s, t) => {
    const at = (d: number) => round(t + d)
    const dur = mpEnterDur(m, 0.7)
    const l = [`      tl.from("${sel} .cta-h", { opacity: 0, y: 44, duration: ${dur}, ease: "${enterEase(m)}" }, ${at(0.2)});`]
    if (m.cta.command) l.push(`      tl.from("${sel} .cmd", { opacity: 0, y: 24, duration: ${round(dur * 0.85)}, ease: "${backEase(m, 1.6)}" }, ${at(0.6)});`)
    return l
  },
}

const ctaFullbleed: ShotDef = {
  render: (m, sid) =>
    clip(
      sid,
      "sc-cta-full",
      `        <div class="cta-h">${esc(m.cta.headline)}</div>
        ${m.cta.command ? `<div class="cmd mono"><span class="p">↗</span> ${esc(m.cta.command)}</div>` : ""}`
    ),
  timeline: (m, sel, _s, t) => {
    const at = (d: number) => round(t + d)
    const dur = mpEnterDur(m, 0.8)
    // 满屏纯色镜头：先在 t=0 隐藏，避免遮盖前序帧（check: gsap_fullscreen_overlay_starts_visible），再于本镜起点淡入
    const l = [
      `      tl.set("${sel}", { opacity: 0 }, 0);`,
      `      tl.to("${sel}", { opacity: 1, duration: 0.5, ease: "power1.out" }, ${at(0)});`,
      `      tl.from("${sel} .cta-h", { opacity: 0, y: 48, scale: 0.96, duration: ${dur}, ease: "${enterEase(m)}" }, ${at(0.25)});`,
    ]
    if (m.cta.command) l.push(`      tl.from("${sel} .cmd", { opacity: 0, y: 24, duration: ${round(dur * 0.75)}, ease: "${backEase(m, 1.6)}" }, ${at(0.7)});`)
    return l
  },
}

// ============================================================
// 镜头注册表
// ============================================================

// ============================================================
// 新增镜头：data-chart / terminal-demo / typing-effect / scroll-demo / video-shot
// ============================================================

const dataChart: ShotDef = {
  render: (_m, sid, scene) => {
    const stats = scene.stats || []
    const bars = stats.slice(0, 6).map((s, i) => {
      const h = 40 + (i * 10)
      return `<div class="chart-bar"><div class="bar-fill" style="--target-h:${h}%"></div><span class="bar-value mono">${esc(s.value)}</span><span class="bar-label">${esc(s.label)}</span></div>`
    }).join("")
    return clip(sid, "sc-chart", `
      <div class="chart-eyebrow">KEY METRICS</div>
      <div class="chart-title">${esc("Metrics")}</div>
      <div class="chart-bars">${bars}</div>
    `)
  },
  timeline: (_m, sel, scene, t) => {
    const at = (d: number) => round(t + d)
    return [
      `      tl.from("${sel} .chart-title", { clipPath: "inset(0 100% 0 0)", duration: 0.6, ease: "power3.out" }, ${at(0.1)});`,
      `      tl.from("${sel} .bar-fill", { height: 0, duration: 0.8, ease: "power2.out", stagger: 0.15 }, ${at(0.3)});`,
      `      tl.from("${sel} .bar-value", { opacity: 0, y: 10, duration: 0.5, stagger: 0.15 }, ${at(0.5)});`,
    ]
  },
}

const terminalDemo: ShotDef = {
  render: (m, sid) => {
    const brand = m.brand?.title || "app"
    const cmd = m.cta?.command || `npx ${brand}`
    const lines = [
      { type: "prompt", text: `$ npm install ${brand.toLowerCase().replace(/\s+/g, "-")}` },
      { type: "success", text: "+ installed 142 packages in 3.2s" },
      { type: "prompt", text: `$ ${cmd}` },
      { type: "info", text: "  Creating project structure..." },
      { type: "success", text: "  ✓ Project ready." },
    ]
    const linesHtml = lines.map(l => `<div class="term-line term-${l.type}">${esc(l.text)}</div>`).join("")
    return clip(sid, "sc-terminal", `
      <div class="terminal">
        <div class="term-bar"><span class="term-title mono">Terminal</span></div>
        <div class="term-body mono">${linesHtml}<span class="term-cursor">█</span></div>
      </div>
    `)
  },
  timeline: (_m, sel, _scene, t) => {
    const at = (d: number) => round(t + d)
    return [
      `      tl.from("${sel} .terminal", { y: 30, opacity: 0, duration: 0.6, ease: "power3.out" }, ${at(0.1)});`,
      `      tl.from("${sel} .term-line", { opacity: 0, x: -10, duration: 0.4, ease: "power2.out", stagger: 0.3 }, ${at(0.3)});`,
      `      tl.to("${sel} .term-cursor", { opacity: 0, duration: 0.6, ease: "sine.inOut", yoyo: true, repeat: -1 }, ${at(0.3)});`,
    ]
  },
}

const typingEffect: ShotDef = {
  render: (m, sid, scene) => {
    const headline = m.hero?.headline || ""
    return clip(sid, "sc-typing", `
      <div class="typing-wrap">
        <div class="typing-text">${esc(headline)}</div>
        <div class="typing-cursor">|</div>
      </div>
    `)
  },
  timeline: (_m, sel, _scene, t) => {
    const at = (d: number) => round(t + d)
    return [
      `      tl.from("${sel} .typing-text", { clipPath: "inset(0 100% 0 0)", duration: 1.5, ease: "steps(20)" }, ${at(0.2)});`,
      `      tl.to("${sel} .typing-cursor", { opacity: 0, duration: 0.5, ease: "sine.inOut", yoyo: true, repeat: -1 }, ${at(0.2)});`,
    ]
  },
}

const scrollDemo: ShotDef = {
  render: (_m, sid, scene) => {
    const imgSrc = scene.shots?.[0]?.src || ""
    return clip(sid, "sc-scroll", `
      <div class="scroll-window">
        <div class="scroll-window-bar">
          <span class="shot-window-dot r"></span>
          <span class="shot-window-dot y"></span>
          <span class="shot-window-dot g"></span>
        </div>
        <div class="scroll-viewport">
          <img src="${esc(imgSrc)}" class="scroll-content" />
        </div>
      </div>
    `)
  },
  timeline: (_m, sel, scene, t) => {
    const at = (d: number) => round(t + d)
    return [
      `      tl.from("${sel} .scroll-window", { opacity: 0, scale: 0.95, duration: 0.8, ease: "power3.out" }, ${at(0.1)});`,
      `      tl.to("${sel} .scroll-content", { y: "-40%", duration: ${round(scene.duration - 1)}, ease: "sine.inOut" }, ${at(0.5)});`,
    ]
  },
}

const videoShot: ShotDef = {
  render: (_m, sid, scene) => {
    const videoSrc = scene.shots?.[0]?.src || ""
    return clip(sid, "sc-video", `
      <div class="video-window">
        <video class="video-element" src="${esc(videoSrc)}" muted playsinline></video>
      </div>
    `)
  },
  timeline: (_m, sel, _scene, t) => {
    const at = (d: number) => round(t + d)
    return [
      `      tl.from("${sel} .video-window", { opacity: 0, y: 40, scale: 0.96, duration: 0.9, ease: "power3.out" }, ${at(0.2)});`,
    ]
  },
}

// ============================================================
// 镜头注册表
// ============================================================

const SHOTS: Record<ShotType, ShotDef> = {
  "brand-center": brandCenter,
  "brand-side": brandSide,
  "hero-split": heroSplit,
  "hero-stack": heroStack,
  "shot-window": shotWindow,
  "shot-tilt": shotTilt,
  "shot-zoom": shotZoom,
  "shot-split": shotSplit,
  "feature-row": featureRow,
  "feature-stack": featureStack,
  "data-counter": dataCounter,
  "chips-marquee": chipsMarquee,
  "logo-wall": logoWall,
  "pricing": pricingTable,
  "cta-push": ctaPush,
  "cta-fullbleed": ctaFullbleed,
  "data-chart": dataChart,
  "terminal-demo": terminalDemo,
  "typing-effect": typingEffect,
  "scroll-demo": scrollDemo,
  "video-shot": videoShot,
}

/** 生成一个场景的 clip 外壳（注入真实 start/duration） */
function renderScene(m: VideoModel, scene: Scene, index: number): string {
  const sid = `s${index}`
  const def = SHOTS[scene.kind] || shotWindow
  const html = def.render(m, sid, scene)
  return html.replace(
    'data-start="0" data-duration="1"',
    `data-start="${round(scene.start)}" data-duration="${round(scene.duration)}"`
  )
}

/** 皮肤级转场签名：crossfade 软叠化 / flash 闪白硬切 / cut 纯硬切；并守护满屏纯色镜头首帧不可见 */
function buildTimeline(m: VideoModel): string {
  const lines: string[] = []
  const trans = effectiveTransition(m)
  // 满屏纯色镜头(会遮盖前序帧)：cta-fullbleed 恒是；kinetic 皮肤下 brand 亦满屏强调色
  const isSolidFull = (kind: ShotType) =>
    kind === "cta-fullbleed" || (m.skin.id === "kinetic" && (kind === "brand-center" || kind === "brand-side"))
  m.scenes.forEach((scene, index) => {
    const def = SHOTS[scene.kind] || shotWindow
    const sel = `#s${index}`
    const start = round(scene.start)
    // 满屏纯色镜头先在 t=0 隐藏再于本镜起点淡入(check: gsap_fullscreen_overlay_starts_visible)；
    // cta-fullbleed 自身 timeline 已处理，这里只补 kinetic 的 brand 满屏镜头
    if (isSolidFull(scene.kind) && scene.kind !== "cta-fullbleed") {
      lines.push(`      tl.set("${sel}", { opacity: 0 }, 0);`)
      lines.push(`      tl.to("${sel}", { opacity: 1, duration: 0.4, ease: "power1.out" }, ${start});`)
    }
    // 软叠化：非首镜、非满屏纯色镜头，整片淡入(editorial 的缓慢叠化质感)
    if (trans === "crossfade" && index > 0 && !isSolidFull(scene.kind)) {
      lines.push(`      tl.from("${sel}", { opacity: 0, duration: 0.6, ease: "power1.inOut" }, ${start});`)
    }
    lines.push(...def.timeline(m, sel, scene, scene.start))
    // 深度层视差动画
    const sceneDur = round(scene.duration)
    const tStart = round(scene.start)
    lines.push(`      tl.fromTo("${sel} .depth-bg", { x: -8, y: -4 }, { x: 8, y: 4, duration: ${sceneDur}, ease: "sine.inOut" }, ${tStart});`)
    lines.push(`      tl.fromTo("${sel} .depth-mid", { x: 4, y: 2 }, { x: -4, y: -2, duration: ${sceneDur}, ease: "sine.inOut" }, ${tStart});`)
    lines.push(`      tl.to("${sel} .depth-fg .geo", { y: "+=3", duration: 2, ease: "sine.inOut", yoyo: true, repeat: -1 }, ${tStart});`)
    // 闪白硬切：非首镜，在切点前后一次白闪脉冲(kinetic 的高能量硬切)
    if (trans === "flash" && index > 0) {
      lines.push(`      tl.to(".fx-flash", { opacity: 0.92, duration: 0.09, ease: "power1.in" }, ${round(start - 0.09)});`)
      lines.push(`      tl.to(".fx-flash", { opacity: 0, duration: 0.2, ease: "power1.out" }, ${start});`)
    }
    // wipe 转场：从左侧滑入遮罩 + 淡入
    if (trans === "wipe" && index > 0 && !isSolidFull(scene.kind)) {
      lines.push(`      tl.from("${sel}", { x: 120, opacity: 0, duration: 0.7, ease: "power3.inOut" }, ${start});`)
    }
    // cut：不加任何转场，clip 窗口化天然硬切(technical 的紧凑硬切)
  })
  return lines.join("\n")
}

// HyperFrames 渲染器可自动解析（下载）的常见字体族；不在此列且非系统族的自定义字体
// 需要显式 @font-face 声明，否则 check 报 font_family_without_font_face。
const AUTO_RESOLVED_FONTS = new Set([
  "inter", "roboto", "open sans", "lato", "montserrat", "poppins", "raleway",
  "nunito", "nunito sans", "work sans", "source sans pro", "source code pro",
  "ibm plex sans", "ibm plex mono", "playfair display", "merriweather",
  "dm sans", "space grotesk", "manrope", "figtree", "jetbrains mono", "roboto mono",
])
const GENERIC_FONTS = new Set([
  "system-ui", "-apple-system", "blinkmacsystemfont", "segoe ui", "sans-serif",
  "serif", "monospace", "ui-monospace", "ui-sans-serif", "ui-serif",
  "cursive", "fantasy", "emoji", "math", "fangsong", "apple color emoji",
])

/** 为字体栈中「渲染器不会自动解析」的自定义字体族补 @font-face local() 声明，
 *  满足 check 且不干扰 Inter 等可自动下载的字体（未安装时自然回退到栈内下一个可解析字体）。 */
function fontFaceFallbacks(fontFamily: string): string {
  const seen = new Set<string>()
  const faces: string[] = []
  for (const raw of fontFamily.split(",")) {
    const name = raw.trim().replace(/^["']|["']$/g, "")
    const key = name.toLowerCase()
    if (!name || seen.has(key) || GENERIC_FONTS.has(key) || AUTO_RESOLVED_FONTS.has(key)) continue
    seen.add(key)
    faces.push(`      @font-face { font-family: '${name}'; src: local('${name}'); }`)
  }
  return faces.length ? faces.join("\n") + "\n" : ""
}

/** CSS：品牌变量 + 所有镜头样式（未用到的样式无害；全部注入，保持简单） */
function buildCss(m: VideoModel): string {
  const p = m.palette
  return `${fontFaceFallbacks(p.fontFamily)}      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: ${p.bg}; }
      :root {
        --fg: ${p.fg}; --bg: ${p.bg}; --accent: ${p.accent}; --accent-fg: ${p.accentFg};
        --muted: ${p.muted}; --secondary: ${p.secondary}; --border: ${p.border}; --radius: 10px;
      }
      body { font-family: ${p.fontFamily}; color: var(--fg); -webkit-font-smoothing: antialiased; }
      .clip { position: absolute; inset: 0; }
      .mono { font-family: "JetBrains Mono", ui-monospace, monospace; }
      .fx-flash { position: absolute; inset: 0; background: #ffffff; opacity: 0; pointer-events: none; z-index: 90; }

      /* --- 品牌 --- */
      .sc-brand-center { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; }
      .brand { font-size: 150px; font-weight: 800; letter-spacing: -0.05em; text-align: center; padding: 0 80px; overflow-wrap: break-word; hyphens: auto; }
      .rule { width: 360px; height: 3px; background: var(--accent); transform-origin: center; }
      .brand-sub { font-size: 30px; color: var(--muted); letter-spacing: 0.02em; text-align: center; padding: 0 120px; }
      .sc-brand-side { display: flex; align-items: center; gap: 56px; padding: 0 180px; }
      .sc-brand-side .bs-bar { width: 12px; height: 460px; background: var(--accent); border-radius: 6px; transform-origin: top; }
      .sc-brand-side .brand { font-size: 130px; text-align: left; padding: 0; }
      .sc-brand-side .brand-sub { text-align: left; padding: 0; margin-top: 24px; max-width: 900px; }

      /* --- 英雄 --- */
      .sc-hero-split { display: grid; grid-template-columns: 1.1fr 0.9fr; align-items: center; padding: 0 140px; gap: 80px; }
      .sc-hero-stack { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 200px; text-align: center; }
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
      .chip { display: inline-flex; align-items: center; height: 60px; padding: 0 28px; border-radius: var(--radius); font-size: 22px; font-weight: 500; border: 1px solid var(--border); background: var(--bg); white-space: nowrap; }

      /* --- 截图窗口（window / zoom 共用） --- */
      .sc-window, .sc-zoom { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 40px; }
      .window { width: 1180px; border-radius: 16px; overflow: hidden; background: var(--bg); box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 8px 40px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2); }
      /* 16:9 内容帧：object-fit cover 填满，绝不露白边；品牌次色兑底 */
      .viewport { width: 100%; height: 692px; overflow: hidden; position: relative; background: var(--secondary); }
      .viewport img, .shot, .zoom-img, .shot-visual { width: 100%; height: 100%; object-fit: cover; object-position: top center; display: block; transform-origin: center center; will-change: transform; }
      /* 字幕：max-width + title-safe 安全边距 + 自动换行 + 字号自适应 + 2 行截断，永不切到画面边缘 */
      .cap { font-size: clamp(24px, 2.4vw, 34px); font-weight: 500; text-align: center; padding: 0 160px; max-width: 1520px; margin-left: auto; margin-right: auto; line-height: 1.28; overflow-wrap: break-word; word-break: break-word; hyphens: auto; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

      /* --- 2.5D 倾斜截图 --- */
      .sc-tilt { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 44px; }
      .tilt-stage { perspective: 1600px; }
      .tilt-card { width: 1200px; height: 675px; border-radius: 16px; overflow: hidden; box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 8px 40px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2); background: var(--secondary); }
      .tilt-img { width: 100%; height: 100%; object-fit: cover; object-position: top center; display: block; transform-origin: center center; will-change: transform; }

      /* --- before/after 分屏 --- */
      .sc-split { display: flex; align-items: center; justify-content: center; padding: 0 90px; }
      .split-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; width: 100%; }
      .sp-pane { position: relative; height: 720px; border-radius: 14px; overflow: hidden; box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 8px 40px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2); background: var(--secondary); }
      .sp-img { width: 100%; height: 100%; object-fit: cover; object-position: top center; display: block; }
      .sp-badge { position: absolute; top: 22px; left: 22px; z-index: 2; height: 46px; padding: 0 22px; display: inline-flex; align-items: center; border-radius: 999px; font-size: 22px; font-weight: 600; background: var(--accent); color: var(--accent-fg); }

      /* --- 特性行 --- */
      .sc-frow { display: flex; align-items: center; justify-content: center; gap: 44px; padding: 0 120px; }
      .vcard { width: 480px; height: 440px; border: 1px solid var(--border); border-radius: 20px; padding: 52px; display: flex; flex-direction: column; }
      .vnum { font-size: 26px; color: var(--muted); }
      .vtitle { font-size: 54px; font-weight: 800; letter-spacing: -0.03em; margin-top: 20px; }
      .vdesc { font-size: 26px; color: var(--muted); line-height: 1.5; margin-top: auto; }

      /* --- 特性堆叠 --- */
      .sc-fstack { display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: 36px; padding: 0 320px; }
      .frow { display: flex; align-items: flex-start; gap: 40px; border-bottom: 1px solid var(--border); padding-bottom: 32px; }
      .frow:last-child { border-bottom: none; }
      .fnum { font-size: 40px; color: var(--accent); font-weight: 700; min-width: 90px; }
      .ftitle { font-size: 52px; font-weight: 800; letter-spacing: -0.03em; }
      .fdesc { font-size: 26px; color: var(--muted); line-height: 1.5; margin-top: 12px; max-width: 900px; }

      /* --- 数据计数 --- */
      .sc-data { display: flex; align-items: center; justify-content: center; gap: 60px; padding: 0 120px; }
      .dcard { display: flex; flex-direction: column; align-items: center; gap: 18px; min-width: 360px; }
      .dval { font-size: 150px; font-weight: 800; letter-spacing: -0.04em; color: var(--accent); font-variant-numeric: tabular-nums; }
      .dlabel { font-size: 30px; color: var(--muted); text-align: center; max-width: 400px; }

      /* --- 标签跑马灯 --- */
      .sc-marquee { display: flex; align-items: center; justify-content: flex-start; }
      .mq-track { display: flex; gap: 24px; padding: 0 100px; white-space: nowrap; }
      .sc-marquee .chip { height: 84px; font-size: 34px; padding: 0 40px; }

      /* --- CTA --- */
      .sc-cta-push { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 40px; }
      .sc-cta-full { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 40px; background: var(--accent); color: var(--accent-fg); }
      .cta-h { font-size: 96px; font-weight: 800; letter-spacing: -0.04em; text-align: center; padding: 0 80px; max-width: 1640px; margin-left: auto; margin-right: auto; overflow-wrap: break-word; }
      .sc-cta-push .cmd { display: inline-flex; align-items: center; gap: 16px; height: 84px; padding: 0 40px; background: var(--secondary); border: 1px solid var(--border); border-radius: 14px; font-size: 34px; color: var(--fg); }
      .sc-cta-push .cmd .p { color: var(--muted); }
      .sc-cta-full .cmd { display: inline-flex; align-items: center; gap: 16px; height: 84px; padding: 0 40px; background: transparent; border: 1px solid var(--accent-fg); border-radius: 14px; font-size: 34px; color: var(--accent-fg); }
      .sc-cta-full .cmd .p { color: var(--accent-fg); }

      /* --- logo 墙 --- */
      .sc-logos { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 56px; padding: 0 160px; }
      .logos-title { font-size: 44px; font-weight: 700; letter-spacing: -0.02em; color: var(--muted); text-align: center; }
      .logo-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px; width: 100%; max-width: 1440px; }
      .logo-cell { height: 130px; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0 24px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--secondary); font-size: 32px; font-weight: 700; letter-spacing: -0.01em; overflow: hidden; }

      /* --- 定价 --- */
      .sc-pricing { display: flex; align-items: center; justify-content: center; gap: 40px; padding: 0 120px; }
      .price-card { width: 380px; min-height: 420px; border: 1px solid var(--border); border-radius: 20px; padding: 52px 44px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; background: var(--bg); }
      .price-featured { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); transform: scale(1.06); }
      .price-name { font-size: 40px; font-weight: 700; letter-spacing: -0.02em; text-align: center; }
      .price-val { font-size: 72px; font-weight: 800; letter-spacing: -0.03em; }

      /* ===== 皮肤 A：Editorial / Calm——大留白、大图、轻字重、圆角 pill、软阴影 ===== */
      #root[data-skin="editorial"] { --radius: 22px; }
      #root[data-skin="editorial"] .brand { font-weight: 600; letter-spacing: -0.045em; }
      #root[data-skin="editorial"] .h1 { font-weight: 600; font-size: 92px; letter-spacing: -0.035em; }
      #root[data-skin="editorial"] .sc-hero-split { padding: 0 210px; gap: 120px; }
      #root[data-skin="editorial"] .sc-hero-stack { padding: 0 300px; }
      #root[data-skin="editorial"] .lede { font-size: 34px; line-height: 1.6; margin-top: 40px; }
      #root[data-skin="editorial"] .btn { height: 74px; border-radius: 999px; font-size: 25px; padding: 0 44px; }
      #root[data-skin="editorial"] .chip { border-radius: 999px; height: 64px; }
      #root[data-skin="editorial"] .window,
      #root[data-skin="editorial"] .tilt-card { border-radius: 22px; box-shadow: 0 0 0 1px rgba(255,255,255,0.08), 0 60px 130px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.1); }
      #root[data-skin="editorial"] .cap { font-weight: 400; color: var(--muted); font-size: 32px; }
      #root[data-skin="editorial"] .cta-h { font-weight: 600; }

      /* ===== 皮肤 B：Kinetic / Bold——满屏强调色(首/尾帧)、超大黑体大写、方角、实心按钮 ===== */
      #root[data-skin="kinetic"] { --radius: 4px; }
      #root[data-skin="kinetic"] .brand,
      #root[data-skin="kinetic"] .h1,
      #root[data-skin="kinetic"] .cta-h,
      #root[data-skin="kinetic"] .vtitle,
      #root[data-skin="kinetic"] .ftitle { font-weight: 900; text-transform: uppercase; letter-spacing: -0.02em; }
      #root[data-skin="kinetic"] .brand { font-size: 180px; }
      #root[data-skin="kinetic"] .h1 { font-size: 130px; line-height: 0.92; }
      #root[data-skin="kinetic"] .cta-h { font-size: 120px; }
      /* 开场品牌镜头(场景 0) + 结尾 cta-fullbleed：满屏强调色，文字用 accentFg 保 AA */
      #root[data-skin="kinetic"] .sc-brand-center,
      #root[data-skin="kinetic"] .sc-brand-side { background: var(--accent); }
      #root[data-skin="kinetic"] .sc-brand-center .brand,
      #root[data-skin="kinetic"] .sc-brand-side .brand,
      #root[data-skin="kinetic"] .sc-brand-center .brand-sub,
      #root[data-skin="kinetic"] .sc-brand-side .brand-sub { color: var(--accent-fg); }
      #root[data-skin="kinetic"] .sc-brand-center .rule,
      #root[data-skin="kinetic"] .sc-brand-side .bs-bar { background: var(--accent-fg); }
      #root[data-skin="kinetic"] .btn { border-radius: 4px; font-weight: 800; text-transform: uppercase; height: 72px; font-size: 24px; }
      #root[data-skin="kinetic"] .chip { border-radius: 4px; font-weight: 700; }
      #root[data-skin="kinetic"] .window,
      #root[data-skin="kinetic"] .tilt-card,
      #root[data-skin="kinetic"] .sp-pane { border-radius: 6px; box-shadow: 0 0 0 2px rgba(255,255,255,0.06), 0 40px 80px rgba(0,0,0,0.32), 0 2px 8px rgba(0,0,0,0.2); }
      #root[data-skin="kinetic"] .cap { font-weight: 800; text-transform: uppercase; font-size: 32px; letter-spacing: 0.02em; }

      /* ===== 皮肤 C：Technical / Grid——等宽标题、网格底纹、方角描边、双色调 ===== */
      #root[data-skin="technical"] {
        --radius: 2px;
        background-image:
          repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px 80px),
          repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px 80px);
        background-position: -1px -1px;
      }
      #root[data-skin="technical"] .brand,
      #root[data-skin="technical"] .h1,
      #root[data-skin="technical"] .cta-h,
      #root[data-skin="technical"] .ftitle,
      #root[data-skin="technical"] .vtitle,
      #root[data-skin="technical"] .lede,
      #root[data-skin="technical"] .cap { font-family: "JetBrains Mono", ui-monospace, monospace; letter-spacing: -0.02em; }
      #root[data-skin="technical"] .brand { font-size: 120px; font-weight: 700; }
      #root[data-skin="technical"] .h1 { font-size: 76px; font-weight: 700; }
      #root[data-skin="technical"] .lede { font-size: 26px; letter-spacing: 0; }
      #root[data-skin="technical"] .cap { font-size: 26px; letter-spacing: 0; color: var(--fg); }
      #root[data-skin="technical"] .btn { border-radius: 2px; border: 2px solid var(--fg); font-family: "JetBrains Mono", ui-monospace, monospace; text-transform: uppercase; font-size: 20px; }
      #root[data-skin="technical"] .btn-primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
      #root[data-skin="technical"] .chip { border-radius: 2px; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 20px; }
      #root[data-skin="technical"] .window,
      #root[data-skin="technical"] .tilt-card,
      #root[data-skin="technical"] .sp-pane { border-radius: 2px; border: 2px solid var(--fg); box-shadow: 0 0 0 1px rgba(255,255,255,0.03), 0 4px 20px rgba(0,0,0,0.12); }
      #root[data-skin="technical"] .rule,
      #root[data-skin="technical"] .bs-bar { background: var(--accent); }

      /* --- data-chart --- */
      .sc-chart { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 32px; padding: 0 80px; }
      .chart-eyebrow { font-size: 14px; text-transform: uppercase; letter-spacing: 3px; color: var(--accent); }
      .chart-title { font-size: 36px; font-weight: 800; letter-spacing: -1px; }
      .chart-bars { display: flex; align-items: flex-end; gap: 32px; height: 400px; width: 100%; max-width: 1200px; }
      .chart-bar { display: flex; flex-direction: column; align-items: center; flex: 1; height: 100%; justify-content: flex-end; }
      .bar-fill { width: 100%; background: var(--accent); border-radius: 8px 8px 0 0; height: var(--target-h, 50%); }
      .bar-value { font-size: 36px; font-weight: 800; color: var(--accent); margin-bottom: 8px; }
      .bar-label { font-size: 14px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; }

      /* --- terminal-demo --- */
      .sc-terminal { display: flex; align-items: center; justify-content: center; height: 100%; }
      .terminal { width: 960px; border-radius: 12px; overflow: hidden; border: 1px solid var(--border); background: #1a1a1a; }
      .term-bar { height: 40px; background: #2a2a2a; display: flex; align-items: center; padding: 0 16px; }
      .term-title { color: #999; font-size: 14px; }
      .term-body { padding: 24px; font-size: 18px; line-height: 1.8; }
      .term-line { opacity: 1; }
      .term-line.term-prompt { color: #e0e0e0; }
      .term-line.term-success { color: #4ade80; }
      .term-line.term-info { color: #94a3b8; }
      .term-cursor { display: inline-block; color: var(--accent); }

      /* --- typing-effect --- */
      .sc-typing { display: flex; align-items: center; justify-content: center; height: 100%; }
      .typing-wrap { display: flex; align-items: center; gap: 4px; }
      .typing-text { font-size: 64px; font-weight: 800; letter-spacing: -2px; clip-path: inset(0 0 0 0); }
      .typing-cursor { font-size: 64px; font-weight: 300; color: var(--accent); }

      /* --- scroll-demo --- */
      .sc-scroll { display: flex; align-items: center; justify-content: center; height: 100%; }
      .scroll-window { width: 1000px; height: 600px; border-radius: 12px; overflow: hidden; border: 1px solid var(--border); box-shadow: 0 20px 60px rgba(0,0,0,0.15); }
      .scroll-window-bar { height: 32px; background: var(--secondary); display: flex; align-items: center; padding: 0 12px; gap: 6px; }
      .scroll-viewport { height: calc(100% - 32px); overflow: hidden; }
      .scroll-content { width: 100%; object-fit: cover; }

      /* --- video-shot --- */
      .sc-video { display: flex; align-items: center; justify-content: center; height: 100%; }
      .video-window { width: 1200px; border-radius: 12px; overflow: hidden; border: 1px solid var(--border); box-shadow: 0 20px 60px rgba(0,0,0,0.15); }
      .video-element { width: 100%; display: block; }

      /* 深度层基础 */
      .depth-bg { position: absolute; inset: 0; z-index: 1; pointer-events: none; overflow: hidden; }
      .depth-mid { position: absolute; inset: 0; z-index: 2; pointer-events: none; overflow: hidden; }
      .depth-content { position: absolute; inset: 0; z-index: 3; }
      .depth-fg { position: absolute; inset: 0; z-index: 4; pointer-events: none; overflow: hidden; }

      /* 皮肤: Editorial — 柔和渐变 */
      [data-skin="editorial"] .depth-bg {
        background: radial-gradient(ellipse at 30% 40%, var(--accent) 8%, transparent 60%);
        opacity: 0.06;
      }
      [data-skin="editorial"] .depth-mid {
        background: repeating-linear-gradient(90deg, var(--border) 0 1px, transparent 1px 120px);
        opacity: 0.08;
      }

      /* 皮肤: Kinetic — 强调色块 */
      [data-skin="kinetic"] .depth-bg {
        background: linear-gradient(135deg, var(--accent) 0%, transparent 50%);
        opacity: 0.08;
      }
      [data-skin="kinetic"] .depth-mid {
        background: repeating-linear-gradient(45deg, var(--border) 0 1px, transparent 1px 100px);
        opacity: 0.06;
      }

      /* 皮肤: Technical — 网格底纹 */
      [data-skin="technical"] .depth-bg {
        background-image:
          repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px 80px),
          repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px 80px);
        opacity: 0.4;
      }
      [data-skin="technical"] .depth-mid {
        background: radial-gradient(circle at 70% 60%, var(--accent) 5%, transparent 40%);
        opacity: 0.05;
      }

      /* 前景装饰 */
      .depth-fg .geo {
        position: absolute;
        border: 1px solid var(--border);
        opacity: 0.15;
      }
      .depth-fg .geo-1 { width: 60px; height: 60px; top: 10%; right: 8%; transform: rotate(15deg); border-radius: 8px; }
      .depth-fg .geo-2 { width: 40px; height: 40px; bottom: 15%; left: 5%; transform: rotate(-20deg); border-radius: 50%; }
      .depth-fg .geo-3 { width: 80px; height: 1px; top: 40%; right: 15%; background: var(--border); opacity: 0.1; }`
}

/** Map a shot type to its chapter ID */
function shotToChapter(kind: ShotType): ChapterId {
  if (kind === "brand-center" || kind === "brand-side") return "ch1-opening"
  if (kind === "hero-split" || kind === "hero-stack" || kind === "terminal-demo") return "ch2-hero"
  if (kind === "shot-window" || kind === "shot-tilt" || kind === "shot-zoom" || kind === "shot-split" || kind === "scroll-demo" || kind === "video-shot") return "ch3-showcase"
  if (
    kind === "feature-row" || kind === "feature-stack" ||
    kind === "data-counter" || kind === "chips-marquee" ||
    kind === "logo-wall" || kind === "pricing" ||
    kind === "data-chart"
  ) return "ch4-proof"
  if (kind === "typing-effect") return "ch1-opening"
  return "ch5-cta"
}

/**
 * Render a single chapter as a sub-composition HTML string.
 * Reuses the existing shot rendering logic but outputs in <template> wrapped
 * sub-composition format with its own GSAP timeline.
 *
 * Does NOT modify the existing renderIndexHtml behavior.
 */
export function renderChapterHtml(
  chapterId: ChapterId,
  model: VideoModel,
  _palette: unknown,
  _skin: unknown,
): string {
  // Filter scenes belonging to this chapter
  const chapterScenes = model.scenes.filter((s) => shotToChapter(s.kind) === chapterId)

  if (chapterScenes.length === 0) {
    // Empty chapter: minimal template
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

  // Re-time scenes so the first one starts at 0
  const firstStart = chapterScenes[0]!.start
  const reTimedScenes = chapterScenes.map((s) => ({
    ...s,
    start: round(s.start - firstStart),
  }))
  const chapterDuration = reTimedScenes.reduce((sum, s) => sum + s.duration, 0)

  // Build a sub-model for rendering
  const subModel: VideoModel = {
    ...model,
    scenes: reTimedScenes,
    durationSec: round(chapterDuration),
  }

  // Render clips using existing renderScene logic
  const scenesHtml = reTimedScenes.map((s, i) => {
    const html = renderScene(subModel, s, i)
    return html
  }).join("\n\n")

  // Build chapter-local timeline
  const timelineLines: string[] = []
  const trans = effectiveTransition(model)
  reTimedScenes.forEach((scene, index) => {
    const def = SHOTS[scene.kind] || shotWindow
    const sel = `#s${index}`
    const start = round(scene.start)
    timelineLines.push(...def.timeline(subModel, sel, scene, scene.start))
    if (trans === "crossfade" && index > 0) {
      timelineLines.push(`      tl.from("${sel}", { opacity: 0, duration: 0.6, ease: "power1.inOut" }, ${start});`)
    }
    if (trans === "flash" && index > 0) {
      timelineLines.push(`      tl.to(".fx-flash", { opacity: 0.92, duration: 0.09, ease: "power1.in" }, ${round(start - 0.09)});`)
      timelineLines.push(`      tl.to(".fx-flash", { opacity: 0, duration: 0.2, ease: "power1.out" }, ${start});`)
    }
    if (trans === "wipe" && index > 0) {
      timelineLines.push(`      tl.from("${sel}", { x: 120, opacity: 0, duration: 0.7, ease: "power3.inOut" }, ${start});`)
    }
    // 深度层视差动画
    const sceneDur = round(scene.duration)
    const tStart = round(scene.start)
    timelineLines.push(`      tl.fromTo("${sel} .depth-bg", { x: -8, y: -4 }, { x: 8, y: 4, duration: ${sceneDur}, ease: "sine.inOut" }, ${tStart});`)
    timelineLines.push(`      tl.fromTo("${sel} .depth-mid", { x: 4, y: 2 }, { x: -4, y: -2, duration: ${sceneDur}, ease: "sine.inOut" }, ${tStart});`)
    timelineLines.push(`      tl.to("${sel} .depth-fg .geo", { y: "+=3", duration: 2, ease: "sine.inOut", yoyo: true, repeat: -1 }, ${tStart});`)
  })
  const timelineJs = timelineLines.join("\n")
  const css = buildCss(subModel)

  return `<template id="${chapterId}-template">
      <div data-composition-id="${chapterId}" data-width="1920" data-height="1080">
        <style>
${css}
        </style>
${scenesHtml}
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

/** 生成完整的 index.html 字符串 */
export function renderIndexHtml(m: VideoModel): string {
  const total = round(m.durationSec)
  const scenesHtml = m.scenes.map((s, i) => renderScene(m, s, i)).join("\n\n")
  const timeline = buildTimeline(m)
  return `<!doctype html>
<html lang="en" data-resolution="landscape">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="${GSAP_CDN}"></script>
    <style>
${buildCss(m)}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-skin="${m.skin.id}" data-start="0" data-duration="${total}" data-width="1920" data-height="1080">
${m.skin.motion.transition === "flash" ? '      <div class="fx-flash"></div>\n' : ""}
${scenesHtml}
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${timeline}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`
}
