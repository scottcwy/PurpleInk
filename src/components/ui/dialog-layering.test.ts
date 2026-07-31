import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Dialog } from './dialog'

function renderDialog(open: boolean) {
  return renderToStaticMarkup(
    createElement(Dialog, {
      open,
      onClose: () => undefined,
      title: '删除项目',
      description: '此操作无法撤销',
    }),
  )
}

describe('Dialog platform contract', () => {
  it('renders the modal OverlayRoot shell permanently with accessible labelling', () => {
    const markup = renderDialog(true)

    expect(markup).toContain('<dialog')
    expect(markup).toContain('data-overlay-mode="modal"')
    expect(markup).toMatch(/aria-labelledby="[^"]+"/)
    expect(markup).toMatch(/aria-describedby="[^"]+"/)
    expect(markup).toContain('删除项目')
    expect(markup).toContain('此操作无法撤销')
  })

  it('closed 态只保留 dialog 壳，不挂载内容子树', () => {
    // 不变量：闭合覆盖层不呈现任何内容。display:none 子树里的嵌套 modal
    // 仍能 showModal() 抢占 top layer，把可见弹窗连同全文档置为 inert
    //（症状：弹窗按钮全部无法点击，按一次 ESC 才恢复）。
    const markup = renderDialog(false)

    expect(markup).toContain('<dialog')
    expect(markup).toContain('data-overlay-mode="modal"')
    expect(markup).not.toContain('删除项目')
    expect(markup).not.toContain('此操作无法撤销')
    expect(markup).not.toContain('overlay-content')
  })
})
