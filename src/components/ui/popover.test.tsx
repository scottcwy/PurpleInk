import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Popover } from './popover'

function renderPopover(dismissible: boolean, open = false) {
  return renderToStaticMarkup(
    <Popover
      open={open}
      onOpenChange={() => undefined}
      dismissible={dismissible}
      trigger={<button type="button">打开</button>}
    >
      <p>弹出内容</p>
    </Popover>,
  )
}

describe('Popover platform contract', () => {
  it('keeps an auto top-layer surface mounted beside its trigger', () => {
    const markup = renderPopover(true, true)

    expect(markup).toContain('data-overlay-mode="popover"')
    expect(markup).toContain('popover="auto"')
    expect(markup).toContain('打开')
    expect(markup).toContain('弹出内容')
  })

  it('closed 态只保留 popover 壳，不挂载内容子树', () => {
    // 同 Dialog 的不变量：防止闭合覆盖层子树里的嵌套 modal 劫持 top layer。
    const markup = renderPopover(true, false)

    expect(markup).toContain('data-overlay-mode="popover"')
    expect(markup).toContain('打开')
    expect(markup).not.toContain('弹出内容')
  })

  it('uses a manual platform surface while dismissal is disabled', () => {
    expect(renderPopover(false)).toContain('popover="manual"')
  })
})
