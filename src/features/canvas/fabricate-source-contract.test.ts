import { describe, expect, it } from 'vitest'
import { inspectFabricateSource } from './fabricate-source-contract'

const DETERMINISTIC_SCRIPT =
  'const timeline = gsap.timeline({ paused: true }); timeline.seek(frame / fps);'

function source(
  viewport = 'width=1920, height=1080',
  canvas = 'data-composition-id="shot" data-width="1920" data-height="1080"',
  head = '',
) {
  return `<!doctype html>
<html><head><meta name="viewport" content="${viewport}">${head}</head>
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

  it.each([
    [
      'malformed base64',
      'font/woff2',
      '%%%not-base64%%%',
      'font-data-base64',
    ],
    [
      'mismatched MIME and file signature',
      'font/woff2',
      'AAEAAAAAAAAAAAAA',
      'font-data-signature',
    ],
  ])('rejects %s in embedded font bytes', (_name, mime, bytes, ruleId) => {
    const html = source(
      undefined,
      undefined,
      `<style>@font-face{font-family:"Shot";src:url(data:${mime};base64,${bytes}) format("woff2")}</style>`,
    )
    const result = inspectFabricateSource(html)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violations.map((violation) => violation.ruleId)).toContain(ruleId)
    }
  })

  it('accepts a WOFF2 data font with matching bytes and local font sources', () => {
    const html = source(
      undefined,
      undefined,
      [
        '<style>',
        '@font-face{font-family:"Embedded";src:url("data:font/woff2;base64,d09GMgAAAAAAAAAAAAAAAA==") format("woff2")}',
        '@font-face{font-family:"System";src:local("Arial")}',
        '</style>',
      ].join(''),
    )
    expect(inspectFabricateSource(html)).toEqual({
      ok: true,
      violations: [],
    })
  })
})
