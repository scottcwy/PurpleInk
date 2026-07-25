import { describe, expect, it } from 'vitest'
import { inspectFabricateSource } from './fabricate-source-contract'

const DETERMINISTIC_SCRIPT =
  'const timeline = gsap.timeline({ paused: true }); timeline.seek(frame / fps);'

function source(
  viewport = 'width=1920, height=1080',
  canvas = 'data-composition-id="shot" data-width="1920" data-height="1080"'
) {
  return `<!doctype html>
<html><head><meta name="viewport" content="${viewport}"></head>
<body><main ${canvas}></main><script>${DETERMINISTIC_SCRIPT}</script></body></html>`
}

describe('inspectFabricateSource', () => {
  it('accepts one deterministic 1920×1080 composition', () => {
    expect(inspectFabricateSource(source())).toEqual({
      ok: true,
      violations: [],
    })
  })

  it.each([
    ['portrait viewport', source('width=1080, height=1920'), 'viewport-width'],
    [
      'portrait canvas',
      source(undefined, 'data-composition-id="shot" data-width="1080" data-height="1920"'),
      'composition-width',
    ],
    ['missing viewport size', source('width=device-width, initial-scale=1'), 'viewport-width'],
    ['missing composition marker', source(undefined, 'id="shot"'), 'composition-root-count'],
    [
      'contradictory composition size',
      source(undefined, 'data-composition-id="shot" data-width="1920" data-height="720"'),
      'composition-height',
    ],
  ])('rejects %s with stable evidence', (_name, html, ruleId) => {
    const result = inspectFabricateSource(html)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violations.map((violation) => violation.ruleId)).toContain(ruleId)
    }
  })
})
