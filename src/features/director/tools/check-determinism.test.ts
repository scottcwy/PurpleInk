import { describe, expect, it } from 'vitest'
import { createCheckDeterminismTool } from './check-determinism'

const VALID_SOURCE = `<!doctype html><html><head>
<meta name="viewport" content="width=1920, height=1080">
</head><body><main data-composition-id="shot" data-width="1920" data-height="1080"></main>
<script>const timeline = gsap.timeline({ paused: true }); timeline.seek(frame / fps);</script>
</body></html>`

describe('createCheckDeterminismTool', () => {
  it('accepts seek-driven deterministic source', async () => {
    const result = await createCheckDeterminismTool().execute({
      source: VALID_SOURCE,
    })

    expect(result.details).toEqual({ ok: true, violations: [] })
    expect(result.terminate).toBe(true)
  })

  it('keeps the public tool name and returns landscape contract violations', async () => {
    const tool = createCheckDeterminismTool()
    const result = await tool.execute({
      source: VALID_SOURCE.replace('data-width="1920"', 'data-width="1080"'),
    })

    expect(tool.name).toBe('check_determinism')
    expect(result.details).toMatchObject({ ok: false })
    expect(result.content).toContain('composition-width')
    expect(result.terminate).toBe(false)
  })

  it('returns violations without throwing', async () => {
    const result = await createCheckDeterminismTool().execute({
      source: 'requestAnimationFrame(render); const startedAt = Date.now();',
    })

    expect(result.details).toMatchObject({ ok: false })
    expect(result.terminate).toBe(false)
  })
})
