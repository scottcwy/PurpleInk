// Storyboard serializer: outputs HyperFrames STORYBOARD.md format.
// Used for debugging and auditing storyboard content.
import type { Storyboard } from "./types"

/**
 * Serialize a Storyboard object to HyperFrames STORYBOARD.md format.
 * Produces YAML front matter + per-frame markdown blocks.
 */
export function serializeStoryboard(sb: Storyboard): string {
  const lines: string[] = []

  // ── YAML front matter ──
  lines.push("---")
  lines.push(`format: ${sb.globals?.format || "1920x1080"}`)
  lines.push(`duration: ${sb.meta.totalDuration}s`)
  if (sb.globals?.message) {
    lines.push(`message: "${sb.globals.message}"`)
  }
  if (sb.globals?.arc) {
    lines.push(`arc: "${sb.globals.arc}"`)
  }
  if (sb.globals?.audience) {
    lines.push(`audience: "${sb.globals.audience}"`)
  }
  lines.push(`brand: "${sb.meta.brand}"`)
  lines.push(`tagline: "${sb.meta.tagline}"`)
  lines.push(`tone: ${sb.meta.tone}`)
  lines.push(`skin: ${sb.meta.skin}`)
  lines.push("---")
  lines.push("")

  // ── Per-frame blocks ──
  for (let i = 0; i < sb.shots.length; i++) {
    const shot = sb.shots[i]!
    const frameNum = i + 1
    const title = shot.screenText?.headline || shot.visualDescription.slice(0, 40)

    lines.push(`## Frame ${frameNum} — ${title}`)
    lines.push("")
    lines.push(`- id: ${shot.id}`)
    lines.push(`- type: ${shot.type}`)
    lines.push(`- chapter: ${shot.chapter}`)
    lines.push(`- scene: ${shot.visualDescription}`)
    lines.push(`- duration: ${shot.duration}s`)
    lines.push(`- startTime: ${shot.startTime}s`)

    if (shot.transition_in) {
      lines.push(`- transition_in: ${shot.transition_in}`)
    }
    if (shot.transition) {
      lines.push(`- transition_out: ${shot.transition}`)
    }
    if (shot.voiceover) {
      lines.push(`- voiceover: "${shot.voiceover}"`)
    }
    if (shot.narration) {
      lines.push(`- narration: "${shot.narration}"`)
    }
    if (shot.blueprint) {
      lines.push(`- blueprint: ${shot.blueprint}`)
    }
    if (shot.focal) {
      lines.push(`- focal: ${shot.focal}`)
    }
    if (shot.sfx) {
      lines.push(`- sfx: ${shot.sfx}`)
    }
    if (shot.poster !== undefined) {
      lines.push(`- poster: ${shot.poster}s`)
    }
    if (shot.status) {
      lines.push(`- status: ${shot.status}`)
    }
    if (shot.src) {
      lines.push(`- src: ${shot.src}`)
    }
    if (shot.cameraMotion) {
      lines.push(`- cameraMotion: ${shot.cameraMotion}`)
    }

    // Screen text
    if (shot.screenText) {
      const st = shot.screenText
      if (st.headline) lines.push(`- headline: "${st.headline}"`)
      if (st.subheadline) lines.push(`- subheadline: "${st.subheadline}"`)
      if (st.eyebrow) lines.push(`- eyebrow: ${st.eyebrow}`)
      if (st.labels?.length) lines.push(`- labels: ${st.labels.join(", ")}`)
      if (st.data?.length) {
        lines.push("- data:")
        for (const d of st.data) {
          lines.push(`    - ${d.value} ${d.label}`)
        }
      }
      if (st.command) lines.push(`- command: ${st.command}`)
    }

    // Asset candidates
    if (shot.asset_candidates?.length) {
      lines.push("- asset_candidates:")
      for (const a of shot.asset_candidates) {
        lines.push(`    - ${a}`)
      }
    } else if (shot.assets?.length) {
      lines.push("- assets:")
      for (const a of shot.assets) {
        lines.push(`    - ${a}`)
      }
    }

    // Roles
    if (shot.roles) {
      lines.push("- roles:")
      for (const [key, val] of Object.entries(shot.roles)) {
        lines.push(`    ${key}: ${val}`)
      }
    }

    // Layers
    if (shot.layers) {
      lines.push("- layers:")
      for (const [depth, spec] of Object.entries(shot.layers)) {
        if (spec) {
          lines.push(`    ${depth}: ${spec.type}${spec.color ? ` (${spec.color})` : ""}`)
        }
      }
    }

    // Choreography
    if (shot.choreography) {
      lines.push(`- choreography: ease=${shot.choreography.enterEase}, stagger=${shot.choreography.stagger}, exitDelay=${shot.choreography.exitDelay}`)
    }

    lines.push("")
  }

  return lines.join("\n")
}
