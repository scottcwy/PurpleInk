import { describe, expect, it } from 'vitest'
import { styleBibleToneExcerpt } from './style-bible-excerpt'

/**
 * 回归护栏：ASSEMBLE（score/shot-sfx）注入的基调摘录必须始终非空，
 * 否则 scoreAssemblePromptInputSchema / shotSfxPromptInputSchema 的
 * styleBible: z.string().min(1) 会让合法的 DIRECT 产物在 ASSEMBLE 崩溃。
 */
describe('styleBibleToneExcerpt', () => {
  it('skips leading blank paragraphs instead of returning an empty excerpt', () => {
    expect(styleBibleToneExcerpt('\n\n基调：冷峻科技感')).toBe('基调：冷峻科技感')
    expect(styleBibleToneExcerpt('\n  \n基调：温暖手绘')).toBe('基调：温暖手绘')
    // 全空白输入也必须回退到非空结果，满足下游 min(1)。
    expect(styleBibleToneExcerpt('  \n\n  ').length).toBeGreaterThan(0)
  })

  it('caps paragraph-less long text at 1000 code points', () => {
    const longText = '调'.repeat(2500)
    const excerpt = styleBibleToneExcerpt(longText)
    expect(Array.from(excerpt)).toHaveLength(1000)
    expect(excerpt).toBe('调'.repeat(1000))
  })

  it('truncates by code point without splitting surrogate pairs', () => {
    // 第 1000 个 code point 恰好是一个代理对 emoji：按 code unit 截断会切出孤立高位代理。
    const emojiText = `${'a'.repeat(999)}🎬${'b'.repeat(50)}`
    const excerpt = styleBibleToneExcerpt(emojiText)
    expect(Array.from(excerpt)).toHaveLength(1000)
    expect(excerpt.endsWith('🎬')).toBe(true)
    expect(excerpt).not.toMatch(/[\uD800-\uDBFF]$/)
  })
})
