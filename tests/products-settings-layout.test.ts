import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Products settings workspace', () => {
  it('keeps the shell fixed and scrolls the settings main region', () => {
    const source = readFileSync(
      'src/app/products/(app)/settings/settings-form.tsx',
      'utf8',
    )

    expect(source).toContain('data-testid="settings-scroll-region"')
    expect(source).toContain(
      'min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain text-ds-text',
    )
    expect(source).toContain('aria-label="设置分类"')
    expect(source).toContain('lg:sticky lg:top-0')
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

  it('does not keep ISSUE-011 demo placeholders or read-only render concurrency in settings', () => {
    const formSource = readFileSync(
      'src/app/products/(app)/settings/settings-form.tsx',
      'utf8',
    )
    const runtimeSource = readFileSync(
      'src/app/products/(app)/settings/runtime-concurrency-panel.tsx',
      'utf8',
    )
    // ISSUE-011 §7.2 grep contract: zero hits across settings surface.
    expect(formSource).not.toContain('尚未实现')
    expect(formSource).not.toContain('Demo 占位')
    expect(formSource).not.toContain('暂不可配置')
    expect(runtimeSource).not.toContain('尚未实现')
    expect(runtimeSource).not.toContain('Demo 占位')
    expect(runtimeSource).not.toContain('暂不可配置')
    // ISSUE-011 §3.1: render concurrency must not collapse to one read-only number.
    expect(formSource).not.toContain('暂不可配置')
  })

  it('exposes runtime concurrency panel and account-level scope marker (ISSUE-011)', () => {
    const formSource = readFileSync(
      'src/app/products/(app)/settings/settings-form.tsx',
      'utf8',
    )
    const runtimeSource = readFileSync(
      'src/app/products/(app)/settings/runtime-concurrency-panel.tsx',
      'utf8',
    )
    expect(formSource).toContain('RuntimeConcurrencyPanel')
    // ISSUE-011 §3.1: lane quotas are account-level, must be labeled.
    expect(runtimeSource).toContain('账号级')
    // ISSUE-011 §3.1: restart-required hint is mandatory, no fake "applied" wording.
    expect(runtimeSource).toContain('重启')
    // ISSUE-011 §3.1: two independent lanes, not one collapsed number.
    expect(runtimeSource).toContain('Director 阶段并发')
    expect(runtimeSource).toContain('渲染并发')
  })
})
