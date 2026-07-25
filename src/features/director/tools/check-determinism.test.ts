import { describe, expect, it } from 'vitest'
import { createCheckDeterminismTool } from './check-determinism'

describe('createCheckDeterminismTool', () => {
  it('accepts seek-driven deterministic source', async () => {
    const result = await createCheckDeterminismTool().execute({
      source: 'const timeline = gsap.timeline({ paused: true }); timeline.seek(frame / fps);',
    })

    expect(result.details).toEqual({ ok: true, violations: [] })
    expect(result.terminate).toBe(true)
  })

  it('returns violations without throwing', async () => {
    const result = await createCheckDeterminismTool().execute({
      source: 'requestAnimationFrame(render); const startedAt = Date.now();',
    })

    expect(result.details).toMatchObject({ ok: false })
    expect(result.terminate).toBe(false)
  })
})
