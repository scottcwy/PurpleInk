import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readMarketingSource = (name: string) =>
  readFileSync(`src/components/marketing/${name}`, 'utf8')

describe('marketing motion contracts', () => {
  it('uses the shared spatial spring for FAQ layout and height', () => {
    const source = readMarketingSource('faq.tsx')

    expect(source).toContain('SPRING_SPATIAL_DEFAULT')
    expect(source).not.toContain('[0.25, 0.46, 0.45, 0.94]')
    expect(source).toContain('default: SPRING_SPATIAL_DEFAULT')
  })

  it('keeps marketing hover feedback on the fast semantic duration', () => {
    const trustedBy = readMarketingSource('trusted-by.tsx')
    const launchComposer = readMarketingSource('launch-composer.tsx')
    const showcaseCards = readMarketingSource('showcase-cards.tsx')
    const bottomCta = readMarketingSource('bottom-cta.tsx')
    const header = readMarketingSource('header.tsx')

    expect(launchComposer).toContain('motionReady && prefersReducedMotion')
    expect(launchComposer).not.toContain(
      'const interactive = prefersReducedMotion',
    )
    expect(trustedBy).not.toContain('transition-all')
    expect(trustedBy.match(/duration-fast/g)?.length).toBeGreaterThanOrEqual(4)
    expect(launchComposer).toContain(
      'transition-transform duration-fast group-hover:translate-x-0.5',
    )
    expect(showcaseCards).toContain(
      'transition-transform duration-fast group-hover:translate-x-0.5',
    )
    expect(bottomCta).not.toContain(['duration', '200'].join('-'))
    expect(bottomCta).toContain('transition-shadow duration-fast ease-standard')
    expect(header).not.toContain(['duration', '300'].join('-'))
  })

  it('flattens scroll-linked and in-view motion for reduced-motion users', () => {
    const hero = readMarketingSource('hero.tsx')
    const toolsCarousel = readMarketingSource('tools-carousel.tsx')

    expect(hero).toContain('useReducedMotion')
    expect(hero).toContain('prefersReducedMotion ? 0')
    expect(hero).toContain('prefersReducedMotion ? 1')
    expect(hero).toContain('motion-reduce:transform-none!')
    expect(hero).toContain('motion-reduce:opacity-100!')
    expect(toolsCarousel).toContain('motion-reduce:transform-none!')
    expect(toolsCarousel).toContain('motion-reduce:opacity-100!')
  })
})
