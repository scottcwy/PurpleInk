import { describe, expect, it } from 'vitest'

import { validateShotHtml } from './gates'

const base = `<!doctype html><html><body data-pi-seed="1"><script>
window.__PURPLEINK_RENDER__ = { ready: true, durationSec: 5, seek(progress) {} }
</script></body></html>`

describe('validateShotHtml', () => {
  it('allows a URL rendered as ordinary on-screen text', () => {
    const html = base.replace('</body>', '<span>http://127.0.0.1:8080/preview</span></body>')

    expect(validateShotHtml(html).passed).toBe(true)
  })

  it.each([
    '<script src="https://example.com/app.js"></script>',
    '<style>.hero{background:url(data:image/png;base64,AAAA)}</style>',
  ])('allows a model-selected visual library or inline asset: %s', (resource) => {
    const html = base.replace('</body>', `${resource}</body>`)

    expect(validateShotHtml(html).passed).toBe(true)
  })

  it('keeps the two essential safety checks', () => {
    expect(validateShotHtml(base.replace('</body>', '<script>eval("x")</script></body>')).passed).toBe(false)
    expect(validateShotHtml(base.replace('</body>', '<p>authorization: Bearer abcdefghijklmnop</p></body>')).passed).toBe(
      false,
    )
  })
})
