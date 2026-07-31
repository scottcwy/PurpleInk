import { describe, expect, it, vi } from 'vitest'
import { createCheckDeterminismTool } from './check-determinism'

vi.mock('server-only', () => ({}))

const VALID_SOURCE = `<!doctype html><html><head>
<meta name="viewport" content="width=1920, height=1080">
<style>
html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; }
* { box-sizing: border-box; }
[data-composition-id] { width: 1920px; height: 1080px; overflow: hidden; }
</style></head><body><main data-composition-id="shot" data-width="1920" data-height="1080"></main>
<script>
const timeline = { seek() {} };
window.__CVC_RENDER__ = {
  version: 1,
  seek(frame, fps) { timeline.seek(frame / fps); },
};
</script>
</body></html>`

describe('createCheckDeterminismTool', () => {
  it('accepts seek-driven deterministic source', async () => {
    const result = await createCheckDeterminismTool({
      probeRuntime: async () => [],
    }).execute({
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

  it('returns browser runtime violations for same-session repair', async () => {
    const result = await createCheckDeterminismTool({
      probeRuntime: async () => [
        {
          ruleId: 'runtime-master-geometry',
          message: '母版画布几何不匹配',
        },
      ],
    }).execute({ source: VALID_SOURCE })

    expect(result.details).toMatchObject({
      ok: false,
      violations: [
        expect.objectContaining({
          ruleId: 'runtime-master-geometry',
          message: '母版画布几何不匹配',
        }),
      ],
    })
    expect(result.terminate).toBe(false)
  })

  it('passes the Director cancellation signal to the browser probe', async () => {
    const controller = new AbortController()
    const probeRuntime = vi.fn(async () => [])

    await createCheckDeterminismTool({ probeRuntime }).execute(
      { source: VALID_SOURCE },
      controller.signal,
    )

    expect(probeRuntime).toHaveBeenCalledWith(
      VALID_SOURCE,
      expect.objectContaining({ signal: controller.signal }),
    )
  })
})
