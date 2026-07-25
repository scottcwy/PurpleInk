import { describe, expect, it } from 'vitest'
import { checkDeterminism, checkSource, isDeterministic } from './check'

describe('checkDeterminism', () => {
  it('flags non-deterministic sources', () => {
    const code = [
      'requestAnimationFrame(loop)',
      'const t = Date.now()',
      'const r = Math.random()',
      'el.style.transition = ""; // transition: all 1s',
    ].join('\n')
    const ids = checkDeterminism(code).map((violation) => violation.ruleId)
    expect(ids).toContain('raf')
    expect(ids).toContain('date-now')
    expect(ids).toContain('math-random')
    expect(ids).toContain('css-transition')
    expect(isDeterministic(code)).toBe(false)
  })

  it('passes deterministic seek-driven code', () => {
    const code = [
      'const tl = gsap.timeline({ paused: true })',
      'tl.seek(frame / fps)',
      'const x = seededRandom(seed + index)',
    ].join('\n')
    expect(checkDeterminism(code)).toEqual([])
    expect(isDeterministic(code)).toBe(true)
  })

  it('checks generated HTML source directly', () => {
    const html = '<script>setTimeout(() => render(), 100)</script>'
    expect(checkSource(html).map((violation) => violation.ruleId)).toContain('set-timeout')
  })

  it('accepts compliant generated HTML source', () => {
    const html = '<script>timeline.seek(frame / fps)</script>'
    expect(checkSource(html)).toEqual([])
  })
})
