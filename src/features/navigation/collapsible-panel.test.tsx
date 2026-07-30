import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DrawerOverlay } from './collapsible-panel'

describe('DrawerOverlay', () => {
  it('uses the modal OverlayRoot without z-index layering', () => {
    const html = renderToStaticMarkup(
      <DrawerOverlay
        open={false}
        onDismiss={() => undefined}
        side="right"
        scrimLabel="关闭测试抽屉"
      >
        抽屉内容
      </DrawerOverlay>,
    )

    expect(html).toContain('<dialog')
    expect(html).toContain('data-overlay-mode="modal"')
    expect(html).toContain('aria-label="关闭测试抽屉"')
    expect(html).not.toMatch(/\bz-(40|50)\b/)
  })

  it('keeps Escape ownership out of all DrawerOverlay consumers', () => {
    for (const file of [
      'src/features/navigation/app-sidebar-shell.tsx',
      'src/app/products/(app)/canvas/[projectId]/canvas-inspector.tsx',
      'src/app/products/(app)/shots/[shotId]/shot-panels.tsx',
    ]) {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toContain("addEventListener('keydown'")
    }
  })
})
