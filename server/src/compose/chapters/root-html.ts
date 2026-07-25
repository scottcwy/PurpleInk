// Build the root index.html that references 5 sub-composition chapter files.
// Each chapter is loaded via data-composition-src pointing to compositions/chX-xxx.html.
// The root timeline orchestrates cross-chapter transitions (crossfade/flash/cut).
import type { ChapterPlan } from "./types"
import type { Palette, VisualSystem } from "../model"
import { logger } from "../../lib/logger"

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Build the root index.html string.
 *
 * Structure:
 * - Fixed 1920x1080 canvas
 * - 5 x data-composition-src references to compositions/chX-xxx.html
 * - Skin-level transition animations (crossfade/flash/cut)
 * - Root GSAP timeline registered to window.__timelines["main"]
 */
export function buildRootHtml(
  chapters: ChapterPlan[],
  palette: Palette,
  skin: VisualSystem,
  totalDuration: number,
): string {
  const total = round(totalDuration)
  const transition = skin.motion.transition

  // Check for timeline overlaps
  for (let i = 0; i < chapters.length - 1; i++) {
    const currEnd = chapters[i]!.startSec + chapters[i]!.durationSec
    const nextStart = chapters[i + 1]!.startSec
    if (currEnd > nextStart) {
      logger.warn(`Timeline overlap detected: chapter ${i + 1} ends at ${currEnd.toFixed(1)}s but chapter ${i + 2} starts at ${nextStart.toFixed(1)}s`)
    }
  }

  // Build composition-src entries (skip chapters with 0 duration)
  const compositionRefs = chapters
    .filter((ch) => ch.durationSec > 0)
    .map((ch) => {
      const start = round(ch.startSec)
      const dur = round(ch.durationSec)
      return `      <div data-composition-src="compositions/${ch.id}.html" data-start="${start}" data-duration="${dur}" data-width="1920" data-height="1080"></div>`
    })
    .join("\n")

  // Build root timeline: crossfade between chapters
  const timelineLines: string[] = []
  const activeChapters = chapters.filter((ch) => ch.durationSec > 0)

  for (let i = 0; i < activeChapters.length; i++) {
    const ch = activeChapters[i]!
    const sel = `.chapter-${ch.id}`
    const start = round(ch.startSec)

    if (transition === "crossfade" && i > 0) {
      // Soft crossfade overlap at chapter boundaries
      timelineLines.push(
        `      tl.from("${sel}", { opacity: 0, duration: 0.35, ease: "power1.inOut" }, ${start});`
      )
    } else if (transition === "flash" && i > 0) {
      // Flash white at chapter boundaries
      timelineLines.push(
        `      tl.to(".fx-flash", { opacity: 0.92, duration: 0.09, ease: "power1.in" }, ${round(start - 0.09)});`,
        `      tl.to(".fx-flash", { opacity: 0, duration: 0.2, ease: "power1.out" }, ${start});`
      )
    }
    // "cut" transition: no extra effects, natural hard cut
  }

  const timelineJs = timelineLines.join("\n")
  const flashOverlay = transition === "flash"
    ? '      <div class="fx-flash"></div>\n'
    : ""

  return `<!doctype html>
<html lang="en" data-resolution="landscape">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: ${palette.bg}; }
      :root {
        --fg: ${palette.fg}; --bg: ${palette.bg}; --accent: ${palette.accent}; --accent-fg: ${palette.accentFg};
        --muted: ${palette.muted}; --secondary: ${palette.secondary}; --border: ${palette.border}; --radius: 10px;
      }
      body { font-family: ${palette.fontFamily}; color: var(--fg); -webkit-font-smoothing: antialiased; }
      .fx-flash { position: absolute; inset: 0; background: #ffffff; opacity: 0; pointer-events: none; z-index: 90; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-skin="${skin.id}" data-start="0" data-duration="${total}" data-width="1920" data-height="1080">
${flashOverlay}${compositionRefs}
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${timelineJs}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`
}
