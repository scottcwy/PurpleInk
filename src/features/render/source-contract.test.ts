import { describe, expect, it } from 'vitest'
import { assertDeterministicSource } from './source-contract'

const VALID_SOURCE = `<!doctype html><html><head>
<meta name="viewport" content="width=1920, height=1080">
</head><body><main data-composition-id="shot" data-width="1920" data-height="1080"></main>
<script>const timeline = gsap.timeline({ paused: true }); timeline.seek(frame / fps);</script>
</body></html>`

describe('assertDeterministicSource', () => {
  it('accepts source driven only by an explicit frame seek', () => {
    expect(() =>
      assertDeterministicSource(
        VALID_SOURCE
      )
    ).not.toThrow()
  })

  it('reports stable rule and line evidence for forbidden source', () => {
    expect(() =>
      assertDeterministicSource(
        VALID_SOURCE.replace(
          '<script>',
          '<script>\nrequestAnimationFrame(render)\nDate.now()\n'
        )
      )
    ).toThrow('确定性违规：raf@5, date-now@6')
  })

  it('rejects a deterministic portrait composition before render admission', () => {
    expect(() =>
      assertDeterministicSource(
        VALID_SOURCE.replace(
          'data-width="1920" data-height="1080"',
          'data-width="1080" data-height="1920"'
        )
      )
    ).toThrow('composition-width')
  })
})
