import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MediaViewport } from './media-viewport'

describe('MediaViewport', () => {
  it('provides one shared 16:9 player surface', () => {
    const html = renderToStaticMarkup(
      createElement(
        MediaViewport,
        null,
        createElement('video', { src: '/video.mp4' })
      )
    )
    expect(html).toContain('aspect-video')
    expect(html).toContain('overflow-hidden')
    expect(html).toContain('bg-player-bg')
    expect(html).toContain('<video')
  })

  it('keeps loading content inside the same media geometry', () => {
    const html = renderToStaticMarkup(createElement(MediaViewport, { loading: true }))
    expect(html).toContain('aspect-video')
    expect(html).toContain('aria-busy="true"')
  })
})
