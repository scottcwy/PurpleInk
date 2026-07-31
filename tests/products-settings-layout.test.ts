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
    expect(source).toContain('ariaLabel="设置分类"')
    expect(source).toContain('lg:sticky lg:top-0')
  })

  it('places the section TOC as a right rail, not a second left sidebar', () => {
    const source = readFileSync(
      'src/app/products/(app)/settings/settings-form.tsx',
      'utf8',
    )

    // Content column comes first, SectionNav column second -> renders on the right.
    expect(source).toContain('lg:grid-cols-[minmax(0,1fr)_200px]')
    expect(source).toContain("import { SectionNav } from '@/components/ui/section-nav'")
    expect(source).not.toContain("from '@/components/ui/nav-item'")
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
    const routeSource = readFileSync(
      'src/app/products/(app)/settings/workflow-route-panel.tsx',
      'utf8',
    )

    expect(formSource).toContain("@/components/ui/settings-panel")
    expect(modelSource).toContain('ProviderRegistryPanel')
    expect(routeSource).toContain("@/components/ui/settings-panel")
    expect(routeSource).toContain('defaultOpen={false}')
  })

  /**
   * 供应商网格是**家族**而不是 provider id：自定义兼容家族在 registry 里是三个 id
   * （文本视觉 / TTS / ASR，三份独立凭据必须有三个身份），但只出一张卡片，三个接入点
   * 在卡片展开后的面板里按顺序配置。五家内置供应商加一个自定义家族共六张卡片。
   */
  it('shows six provider-family cards and routes media capabilities explicitly', () => {
    const providerSource = readFileSync(
      'src/app/products/(app)/settings/provider-registry-panel.tsx',
      'utf8',
    )
    const customSource = readFileSync(
      'src/app/products/(app)/settings/custom-openai-provider-panel.tsx',
      'utf8',
    )
    const routeSource = readFileSync(
      'src/app/products/(app)/settings/workflow-route-panel.tsx',
      'utf8',
    )

    expect(providerSource).toContain('PROVIDER_CARDS')
    expect(providerSource).not.toContain('AI_PROVIDER_IDS.map')
    expect(providerSource).toContain("useState<ProviderCardId>('mimo')")
    // 三个自定义接入点必须同属一个面板，且按 文本视觉 → TTS → ASR 顺序出现。
    const textIndex = customSource.indexOf('文本与视觉')
    const ttsIndex = customSource.indexOf('CustomOpenAiTtsSection controller')
    const asrIndex = customSource.indexOf('CustomOpenAiAsrSection controller')
    expect(textIndex).toBeGreaterThan(-1)
    expect(ttsIndex).toBeGreaterThan(textIndex)
    expect(asrIndex).toBeGreaterThan(ttsIndex)
    expect(routeSource).toContain("nodeType === 'shot-sfx'")
    expect(routeSource).toContain("nodeType === 'shot-subtitle'")
    expect(routeSource).not.toContain('TTS/ASR 始终使用阶跃星辰')
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
