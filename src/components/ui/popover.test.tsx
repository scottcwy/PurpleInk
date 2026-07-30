import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Popover } from './popover'

function renderPopover(dismissible: boolean) {
  return renderToStaticMarkup(
    <Popover
      open={false}
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
    const markup = renderPopover(true)

    expect(markup).toContain('data-overlay-mode="popover"')
    expect(markup).toContain('popover="auto"')
    expect(markup).toContain('打开')
    expect(markup).toContain('弹出内容')
  })

  it('uses a manual platform surface while dismissal is disabled', () => {
    expect(renderPopover(false)).toContain('popover="manual"')
  })
})
