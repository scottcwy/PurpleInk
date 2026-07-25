import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Products settings workspace', () => {
  it('keeps the shell fixed and scrolls only the settings content region', () => {
    const source = readFileSync(
      'src/app/products/(app)/settings/settings-form.tsx',
      'utf8',
    )

    expect(source).toContain(
      'className="flex min-h-0 flex-1 flex-col overflow-hidden text-ds-text"',
    )
    expect(source).toContain('data-testid="settings-scroll-region"')
    expect(source).toContain(
      'min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain',
    )
    expect(source).toContain('aria-label="设置分类"')
  })

  it('composes long setting groups from the public SettingsPanel primitive', () => {
    const formSource = readFileSync(
      'src/app/products/(app)/settings/settings-form.tsx',
      'utf8',
    )
    const modelSource = readFileSync(
      'src/app/products/(app)/settings/model-service-panels.tsx',
      'utf8',
    )

    expect(formSource).toContain("@/components/ui/settings-panel")
    expect(modelSource).toContain("@/components/ui/settings-panel")
    expect(modelSource).toContain('defaultOpen={false}')
  })
})
