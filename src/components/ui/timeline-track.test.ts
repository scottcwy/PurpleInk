import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/components/ui/timeline-track.tsx', 'utf8')
const demo = readFileSync('src/components/ui/timeline-track.demo.tsx', 'utf8')

describe('TimelineTrack visual contract', () => {
  it('encodes duration as clip width instead of a constant', () => {
    // 常量宽度会让「S001 就绪、S002 缺失、S003 就绪」画成相邻两格，
    // 暗示错误的时间位置且与分镜轨对不齐。
    expect(source).toContain('clip.width')
    expect(source).toContain('clip.start')
    expect(source).not.toMatch(/CLIP_WIDTH|width:\s*`?\d+px/u)
    // 比例定位必须夹取到 0..1，避免脏数据把 clip 画到轨道外。
    expect(source).toContain('Math.min(Math.max(ratio, 0), 1)')
  })

  it('uses exactly one colour hue across the track family', () => {
    // design-quality-pitfalls 1.1：全页主彩色 <= 1 种。原实现给四条轨道配了四个
    // stage 色相。
    expect(source).not.toContain('stage-')
    const hues = [...source.matchAll(/\bds-(blue|green|amber|red|purple)\b/gu)].map(
      (match) => match[1]
    )
    expect(new Set(hues)).toEqual(new Set(['blue']))
  })

  it('keeps every font size at or above 12px', () => {
    // design-quality-pitfalls 1.6：字号梯度 <= 3 级且最小 12px。
    // text-xs 是 12px；任何 text-[11px] / text-[10px] 都不允许再出现。
    expect(source).not.toMatch(/text-\[(?:\d|10|11)px\]/u)
    const sizes = new Set([...source.matchAll(/\btext-(xs|sm|base|lg)\b/gu)].map(
      (match) => match[1]
    ))
    expect(sizes.size).toBeLessThanOrEqual(3)
    expect(sizes.has('xs')).toBe(true)
  })

  it('separates the short track name from its long status text', () => {
    // 固定宽轨道头塞不进整句状态，这是「莫名其妙换行」的根因。
    expect(source).toContain('meta')
    expect(source).toContain('title')
    expect(source).toContain('truncate')
  })

  it('never expresses a muted state by colour alone', () => {
    // AGENTS.md 6：状态必须同时有文本或图标语义。
    expect(source).toContain('emptyLabel')
    expect(source).toMatch(/muted[\s\S]*text-ds-text-muted/u)
  })

  it('exposes an action slot and demonstrates all four states', () => {
    expect(source).toContain('action')
    expect(demo).toContain('meta=')
    expect(demo).toContain('muted')
    expect(demo).toContain('emptyLabel')
    expect(demo).toContain('action=')
  })
})
