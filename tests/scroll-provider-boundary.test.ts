import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ROOT_LAYOUT = 'src/app/layout.tsx'
const ROOT_PROVIDERS = 'src/app/providers.tsx'
const MARKETING_LAYOUT = 'src/app/(marketing)/layout.tsx'
const MARKETING_PROVIDERS = 'src/components/marketing/providers.tsx'
const LEGACY_MARKETING_MOTION = 'src/lib/marketing-motion.tsx'
const PRODUCTS_LAYOUT = 'src/app/products/(app)/layout.tsx'
const GLOBAL_STYLES = 'src/app/globals.css'
const SECTION_NAV = 'src/components/ui/section-nav.tsx'

describe('滚动 Provider 路由边界', () => {
  it('根布局只挂全局 Provider，不跨层引用营销 Provider', () => {
    const source = readFileSync(ROOT_LAYOUT, 'utf8')

    expect(source).toMatch(/from ["']@\/app\/providers["']/)
    expect(source).toContain('<RootProviders>')
    expect(source).toContain('<AppMotionConfig>')
    expect(source).not.toContain('@/components/marketing/providers')
  })

  it('根 Provider 只承载全局主题合同', () => {
    expect(existsSync(ROOT_PROVIDERS)).toBe(true)
    if (!existsSync(ROOT_PROVIDERS)) return

    const source = readFileSync(ROOT_PROVIDERS, 'utf8')
    expect(source).toContain('ThemeProvider')
    expect(source).not.toContain('SmoothScroll')
    expect(source).not.toContain('ReducedMotionProvider')
  })

  it('营销 layout 只独占 SmoothScroll，减弱动态效果由根 MotionConfig 负责', () => {
    expect(existsSync(MARKETING_LAYOUT)).toBe(true)
    if (!existsSync(MARKETING_LAYOUT)) return

    const layoutSource = readFileSync(MARKETING_LAYOUT, 'utf8')
    const providerSource = readFileSync(MARKETING_PROVIDERS, 'utf8')
    expect(layoutSource).toContain('@/components/marketing/providers')
    expect(layoutSource).toContain('<MarketingProviders>')
    expect(providerSource).toContain('<SmoothScroll>')
    expect(providerSource).not.toContain('ReducedMotionProvider')
    expect(providerSource).not.toContain('ThemeProvider')
    expect(existsSync(LEGACY_MARKETING_MOTION)).toBe(false)
  })

  it('制作应用壳不引用 Lenis 或营销 Provider', () => {
    const source = readFileSync(PRODUCTS_LAYOUT, 'utf8')
    expect(source).not.toContain('SmoothScroll')
    expect(source).not.toContain('@/components/marketing/providers')
  })

  it('全局不启用原生 smooth，营销与应用目录各自由单一滚动实现负责', () => {
    const rootLayout = readFileSync(ROOT_LAYOUT, 'utf8')
    const globalStyles = readFileSync(GLOBAL_STYLES, 'utf8')
    const sectionNav = readFileSync(SECTION_NAV, 'utf8')

    expect(rootLayout).not.toContain('data-scroll-behavior="smooth"')
    expect(globalStyles).not.toMatch(/\bscroll-behavior\s*:/u)
    expect(sectionNav).toContain('animate(container.scrollTop, to')
    expect(sectionNav).toContain('container.scrollTop = value')
  })
})
