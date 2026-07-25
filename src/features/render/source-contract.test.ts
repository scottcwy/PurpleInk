import { describe, expect, it } from 'vitest'
import { assertDeterministicSource } from './source-contract'

describe('assertDeterministicSource', () => {
  it('accepts source driven only by an explicit frame seek', () => {
    expect(() =>
      assertDeterministicSource(
        'const timeline = gsap.timeline({ paused: true }); timeline.seek(frame / fps);'
      )
    ).not.toThrow()
  })

  it('reports stable rule and line evidence for forbidden source', () => {
    expect(() =>
      assertDeterministicSource(
        '<script>\nrequestAnimationFrame(render)\nDate.now()\n</script>'
      )
    ).toThrow('确定性违规：raf@2, date-now@3')
  })
})
