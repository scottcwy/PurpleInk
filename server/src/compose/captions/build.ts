// Caption build logic: constructs caption entries from storyboard + audio metadata.
// Groups captions by frame, renders caption HTML, and writes caption_groups.json.
import { writeFile } from "node:fs/promises"
import type { AudioMeta, WordTimestamp } from "../audio/types.js"
import type { Storyboard } from "../storyboard/types.js"

/** A single caption entry with timing */
export interface CaptionEntry {
  text: string
  start: number // seconds
  end: number // seconds
  frame: number // owning frame index
}

/** Caption group (grouped by frame) */
export interface CaptionGroup {
  frameId: string
  captions: CaptionEntry[]
}

/** Maximum characters per caption line (Chinese ~20, English ~40) */
const MAX_CHARS_PER_LINE = 30

/**
 * Build captions from storyboard + audio metadata.
 *
 * Logic:
 * 1. Iterate each frame's voiceover and word timestamps
 * 2. Group words into caption lines (~MAX_CHARS_PER_LINE chars per line)
 * 3. Each caption line's duration = corresponding word start/end times
 * 4. Output caption_groups.json
 */
export function buildCaptions(storyboard: Storyboard, audioMeta: AudioMeta | null): CaptionGroup[] {
  if (!audioMeta || !audioMeta.voices.length) {
    return []
  }

  const groups: CaptionGroup[] = []

  for (const voice of audioMeta.voices) {
    const frameIdx = voice.frame
    const shot = storyboard.shots[frameIdx]
    if (!shot) continue

    const captions = groupWordsToCaptions(voice.words, frameIdx)
    if (captions.length > 0) {
      groups.push({
        frameId: shot.id,
        captions,
      })
    }
  }

  return groups
}

/**
 * Group word timestamps into caption lines.
 * Each line contains at most MAX_CHARS_PER_LINE characters.
 */
function groupWordsToCaptions(words: WordTimestamp[], frameIdx: number): CaptionEntry[] {
  if (!words || words.length === 0) return []

  const captions: CaptionEntry[] = []
  let currentText = ""
  let currentStart = words[0]!.start
  let currentEnd = words[0]!.end

  for (const word of words) {
    const wordText = word.text.trim()
    if (!wordText) continue

    // Check if adding this word exceeds the limit
    if (currentText.length + wordText.length > MAX_CHARS_PER_LINE && currentText.length > 0) {
      // Push current line and start new one
      captions.push({
        text: currentText.trim(),
        start: round(currentStart),
        end: round(currentEnd),
        frame: frameIdx,
      })
      currentText = wordText
      currentStart = word.start
      currentEnd = word.end
    } else {
      currentText += (currentText ? " " : "") + wordText
      currentEnd = word.end
    }
  }

  // Push last line
  if (currentText.trim()) {
    captions.push({
      text: currentText.trim(),
      start: round(currentStart),
      end: round(currentEnd),
      frame: frameIdx,
    })
  }

  return captions
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Render caption groups as HTML sub-composition.
 * Outputs compositions/captions.html
 *
 * Each caption entry is a <p> element with data-start and data-duration.
 * Uses GSAP to control opacity fade in/out.
 * Registers to window.__timelines["captions"]
 */
export function renderCaptionsHtml(groups: CaptionGroup[], totalDuration: number): string {
  const total = round(totalDuration)

  // Build caption line HTML elements
  const captionElements: string[] = []
  const timelineLines: string[] = []
  let captionIdx = 0

  for (const group of groups) {
    for (const caption of group.captions) {
      const id = `cap-${captionIdx}`
      const dur = round(caption.end - caption.start)
      const start = round(caption.start)

      captionElements.push(
        `      <p id="${id}" class="caption-line" data-start="${start}" data-duration="${dur}">${escapeHtml(caption.text)}</p>`,
      )

      // GSAP fade in/out
      timelineLines.push(
        `      tl.fromTo("#${id}", { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power2.out" }, ${start});`,
      )
      timelineLines.push(
        `      tl.to("#${id}", { opacity: 0, duration: 0.2, ease: "power2.in" }, ${round(start + dur - 0.2)});`,
      )

      captionIdx++
    }
  }

  const timelineJs = timelineLines.join("\n")

  return `<template id="captions-template">
  <div data-composition-id="captions" data-start="0" data-duration="${total}" data-width="1920" data-height="1080">
    <style>
      .caption-container {
        position: absolute;
        bottom: 8%;
        left: 50%;
        transform: translateX(-50%);
        max-width: 80%;
        z-index: 100;
        pointer-events: none;
      }
      .caption-line {
        display: none;
        background: rgba(0,0,0,0.7);
        color: #ffffff;
        font-size: 1.2rem;
        padding: 0.5em 1em;
        border-radius: 0.25em;
        line-height: 1.4;
        text-align: center;
        max-width: 100%;
        word-wrap: break-word;
      }
    </style>
    <div class="caption-container">
${captionElements.join("\n")}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      var captionTl = gsap.timeline({ paused: true });
${timelineJs}
      window.__timelines["captions"] = captionTl;
    </script>
  </div>
</template>`
}

/** Write caption_groups.json to disk */
export async function writeCaptionGroups(groups: CaptionGroup[], outputPath: string): Promise<void> {
  const json = JSON.stringify(groups, null, 2) + "\n"
  await writeFile(outputPath, json, "utf8")
}

/** Escape HTML special characters */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
