import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Dialog } from './dialog'

describe('Dialog platform contract', () => {
  it('renders the modal OverlayRoot permanently with accessible labelling', () => {
    const markup = renderToStaticMarkup(
      createElement(Dialog, {
        open: false,
        onClose: () => undefined,
        title: '删除项目',
        description: '此操作无法撤销',
      }),
    )

    expect(markup).toContain('<dialog')
    expect(markup).toContain('data-overlay-mode="modal"')
    expect(markup).toMatch(/aria-labelledby="[^"]+"/)
    expect(markup).toMatch(/aria-describedby="[^"]+"/)
    expect(markup).toContain('删除项目')
    expect(markup).toContain('此操作无法撤销')
  })
})
