// VideoModel → index.html。方案 B 的模板：landscape 1920×1080，
// 动态场景(.clip) + 一条 paused GSAP 时间线(window.__timelines["main"])，
// 结构对齐 shadcn-30s 金样本，保证 hyperframes check 通过。
import type { Scene, VideoModel } from "./model"

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

/** 每个场景的 HTML + 对应时间线片段 */
interface SceneParts {
  html: string
  tl: string[]
}

function brandScene(m: VideoModel, sid: string): SceneParts {
  const html = `      <div id="${sid}" class="clip sc-brand" data-start="0" data-duration="1" data-track-index="1">
        <div class="brand">${esc(m.brand.title)}</div>
        <div class="rule"></div>
        ${m.brand.tagline ? `<div class="brand-sub">${esc(m.brand.tagline)}</div>` : ""}
      </div>`
  return { html, tl: [] } // 动画在 buildTimeline 里按 start 生成
}

function heroScene(m: VideoModel, sid: string): SceneParts {
  const buttons = m.hero.ctas
    .map((c, i) => `<span class="btn ${i === 0 ? "btn-primary" : "btn-outline"}">${esc(c)}</span>`)
    .join("\n            ")
  const chips = m.hero.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("\n          ")
  const html = `      <div id="${sid}" class="clip sc-hero" data-start="0" data-duration="1" data-track-index="1">
        <div class="hero-col">
          <div class="h1">${esc(m.hero.headline)}</div>
          ${m.hero.lede ? `<div class="lede">${esc(m.hero.lede)}</div>` : ""}
          ${buttons ? `<div class="btn-row">\n            ${buttons}\n          </div>` : ""}
        </div>
        ${chips ? `<div class="chips">\n          ${chips}\n        </div>` : `<div class="chips"></div>`}
      </div>`
  return { html, tl: [] }
}

function showcaseScene(m: VideoModel, sid: string, shot: NonNullable<Scene["shot"]>): SceneParts {
  const url = m.cta.command || m.brand.title.toLowerCase()
  const html = `      <div id="${sid}" class="clip sc-showcase" data-start="0" data-duration="1" data-track-index="1">
        <div class="window">
          <div class="titlebar">
            <span class="dot" style="background:#ff5f57"></span>
            <span class="dot" style="background:#febc2e"></span>
            <span class="dot" style="background:#28c840"></span>
            <span class="url mono">${esc(url)}</span>
          </div>
          <div class="viewport">
            <img class="shot" src="${esc(shot.src)}" alt="${esc(shot.caption)}" data-layout-allow-overflow />
          </div>
        </div>
        <div class="cap">${esc(shot.caption)}</div>
      </div>`
  return { html, tl: [] }
}

function valueScene(m: VideoModel, sid: string): SceneParts {
  const cards = m.valueProps
    .map(
      (p, i) => `        <div class="vcard">
          <div class="vnum mono">${String(i + 1).padStart(2, "0")}</div>
          <div class="vtitle">${esc(p.title)}</div>
          <div class="vdesc">${esc(p.desc)}</div>
        </div>`
    )
    .join("\n")
  const html = `      <div id="${sid}" class="clip sc-value" data-start="0" data-duration="1" data-track-index="1">
${cards}
      </div>`
  return { html, tl: [] }
}

function ctaScene(m: VideoModel, sid: string): SceneParts {
  const cmd = m.cta.command
  const html = `      <div id="${sid}" class="clip sc-cta" data-start="0" data-duration="1" data-track-index="1">
        <div class="cta-h">${esc(m.cta.headline)}</div>
        ${cmd ? `<div class="cmd mono"><span class="p">↗</span> ${esc(cmd)}</div>` : ""}
      </div>`
  return { html, tl: [] }
}

/** 生成一个场景的 clip 外壳（统一注入真实 start/duration） */
function renderScene(m: VideoModel, scene: Scene, index: number): string {
  const sid = `s${index}`
  let parts: SceneParts
  if (scene.kind === "brand") parts = brandScene(m, sid)
  else if (scene.kind === "hero") parts = heroScene(m, sid)
  else if (scene.kind === "showcase") parts = showcaseScene(m, sid, scene.shot!)
  else if (scene.kind === "value") parts = valueScene(m, sid)
  else parts = ctaScene(m, sid)
  // 用真实 start/duration 覆盖占位（每个场景 clip 根上仅出现一次）
  return parts.html.replace(
    'data-start="0" data-duration="1"',
    `data-start="${round(scene.start)}" data-duration="${round(scene.duration)}"`
  )
}

/** 为每个场景生成 GSAP 动画（相对场景 start 偏移） */
function buildTimeline(m: VideoModel): string {
  const lines: string[] = []
  m.scenes.forEach((scene, index) => {
    const sid = `#s${index}`
    const t = scene.start
    const at = (d: number) => round(t + d)
    if (scene.kind === "brand") {
      lines.push(`      tl.from("${sid} .brand", { opacity: 0, y: 40, duration: 1, ease: "power3.out" }, ${at(0.2)});`)
      lines.push(`      tl.fromTo("${sid} .rule", { width: 0 }, { width: 360, duration: 0.9, ease: "power2.inOut" }, ${at(1.0)});`)
      if (m.brand.tagline) lines.push(`      tl.from("${sid} .brand-sub", { opacity: 0, duration: 0.8, ease: "power2.out" }, ${at(1.4)});`)
    } else if (scene.kind === "hero") {
      lines.push(`      tl.from("${sid} .h1", { opacity: 0, y: 50, duration: 0.9, ease: "power3.out" }, ${at(0.2)});`)
      if (m.hero.lede) lines.push(`      tl.from("${sid} .lede", { opacity: 0, y: 30, duration: 0.8, ease: "power2.out" }, ${at(0.6)});`)
      if (m.hero.ctas.length) lines.push(`      tl.from("${sid} .btn", { opacity: 0, y: 24, duration: 0.6, stagger: 0.12, ease: "back.out(1.6)" }, ${at(1.1)});`)
      if (m.hero.chips.length) lines.push(`      tl.from("${sid} .chip", { opacity: 0, y: 30, scale: 0.9, duration: 0.55, stagger: 0.1, ease: "back.out(1.7)" }, ${at(1.0)});`)
    } else if (scene.kind === "showcase") {
      const panDur = Math.max(2, round(scene.duration - 2.5))
      lines.push(`      tl.from("${sid} .window", { opacity: 0, y: 60, scale: 0.96, duration: 0.9, ease: "power3.out" }, ${at(0.2)});`)
      lines.push(`      tl.from("${sid} .cap", { opacity: 0, y: 20, duration: 0.7, ease: "power2.out" }, ${at(0.8)});`)
      lines.push(`      tl.fromTo("${sid} .shot", { y: 0 }, { y: -560, duration: ${panDur}, ease: "none" }, ${at(1.4)});`)
    } else if (scene.kind === "value") {
      lines.push(`      tl.from("${sid} .vcard", { opacity: 0, y: 50, duration: 0.7, stagger: 0.15, ease: "power3.out" }, ${at(0.2)});`)
    } else {
      lines.push(`      tl.from("${sid} .cta-h", { opacity: 0, y: 40, duration: 0.7, ease: "power3.out" }, ${at(0.2)});`)
      if (m.cta.command) lines.push(`      tl.from("${sid} .cmd", { opacity: 0, y: 24, duration: 0.6, ease: "back.out(1.6)" }, ${at(0.6)});`)
    }
  })
  return lines.join("\n")
}

/** CSS：品牌变量 + 各场景样式（对齐 shadcn-30s） */
function buildCss(m: VideoModel): string {
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

      .sc-brand { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; }
      .brand { font-size: 150px; font-weight: 800; letter-spacing: -0.05em; text-align: center; padding: 0 80px; }
      .rule { width: 0; height: 2px; background: var(--accent); }
      .brand-sub { font-size: 30px; color: var(--muted); letter-spacing: 0.02em; text-align: center; padding: 0 120px; }

      .sc-hero { display: grid; grid-template-columns: 1.1fr 0.9fr; align-items: center; padding: 0 140px; gap: 80px; }
      .h1 { font-size: 84px; font-weight: 800; line-height: 1.03; letter-spacing: -0.04em; max-width: 780px; }
      .lede { font-size: 30px; color: var(--muted); line-height: 1.5; margin-top: 32px; max-width: 680px; }
      .btn-row { display: flex; gap: 20px; margin-top: 48px; }
      .btn { display: inline-flex; align-items: center; height: 64px; padding: 0 34px; border-radius: var(--radius); font-size: 24px; font-weight: 500; }
      .btn-primary { background: var(--accent); color: var(--accent-fg); }
      .btn-outline { background: var(--bg); color: var(--fg); border: 1px solid var(--border); }
      .chips { display: flex; flex-wrap: wrap; gap: 18px; align-content: center; }
      .chip { display: inline-flex; align-items: center; height: 60px; padding: 0 28px; border-radius: var(--radius); font-size: 22px; font-weight: 500; border: 1px solid var(--border); background: var(--bg); }

      .sc-showcase { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 40px; }
      .window { width: 1180px; border-radius: 16px; border: 1px solid var(--border); box-shadow: 0 40px 90px rgba(0,0,0,0.14); overflow: hidden; background: var(--bg); }
      .titlebar { height: 56px; display: flex; align-items: center; gap: 10px; padding: 0 22px; background: var(--secondary); border-bottom: 1px solid var(--border); }
      .dot { width: 14px; height: 14px; border-radius: 999px; }
      .url { margin-left: 22px; font-size: 20px; color: var(--muted); }
      .viewport { height: 620px; overflow: hidden; position: relative; }
      .viewport img { width: 1180px; display: block; }
      .cap { font-size: 34px; font-weight: 500; text-align: center; padding: 0 120px; }

      .sc-value { display: flex; align-items: center; justify-content: center; gap: 44px; padding: 0 120px; }
      .vcard { width: 480px; height: 440px; border: 1px solid var(--border); border-radius: 20px; padding: 52px; display: flex; flex-direction: column; }
      .vnum { font-size: 26px; color: var(--muted); }
      .vtitle { font-size: 54px; font-weight: 800; letter-spacing: -0.03em; margin-top: 20px; }
      .vdesc { font-size: 26px; color: var(--muted); line-height: 1.5; margin-top: auto; }

      .sc-cta { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 40px; }
      .cta-h { font-size: 96px; font-weight: 800; letter-spacing: -0.04em; text-align: center; padding: 0 80px; }
      .cmd { display: inline-flex; align-items: center; gap: 16px; height: 84px; padding: 0 40px; background: var(--secondary); border: 1px solid var(--border); border-radius: 14px; font-size: 34px; color: var(--fg); }
      .cmd .p { color: var(--muted); }`
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
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="1920" data-height="1080">

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
