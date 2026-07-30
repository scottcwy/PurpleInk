import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DURATION,
  EASE,
  SPRING_BOUNCE_MAX,
  SPRING_SPATIAL_DEFAULT,
  SPRING_SPATIAL_FAST,
  SPRING_SPATIAL_SLOW,
  TRANSITION_BASE,
  TRANSITION_EXIT,
  TRANSITION_INSTANT,
  TRANSITION_NARRATIVE,
} from './tokens'

const GLOBALS_CSS = readFileSync('src/app/globals.css', 'utf8')
const SPRINGS = {
  SPRING_SPATIAL_FAST,
  SPRING_SPATIAL_DEFAULT,
  SPRING_SPATIAL_SLOW,
} as const

describe('motion tokens', () => {
  it('keeps durations ascending and in seconds', () => {
    expect(DURATION.fast).toBeLessThan(DURATION.base)
    expect(DURATION.base).toBeLessThan(DURATION.slow)
    expect(DURATION.base).toBeCloseTo(0.22)
  })

  it('defines easings as 4-point cubic-bezier control points', () => {
    for (const ease of Object.values(EASE)) {
      expect(ease).toHaveLength(4)
    }
  })

  it('derives the base transition from the standard ease + base duration', () => {
    expect(TRANSITION_BASE.duration).toBe(DURATION.base)
    expect(TRANSITION_BASE.ease).toEqual(EASE.standard)
  })

  it('disables animation for the instant (drag) transition', () => {
    expect(TRANSITION_INSTANT.duration).toBe(0)
  })

  it('uses the narrative duration only for the marketing transition', () => {
    expect(TRANSITION_NARRATIVE.duration).toBe(DURATION.narrative)
    expect(TRANSITION_BASE.duration).not.toBe(DURATION.narrative)
  })
})

/**
 * 双镜像同步：JS 侧（本目录）与 CSS 侧（globals.css）必须逐项一致。
 * 缺了这组断言，两边会静默漂移——这正是 150ms 成为事实标准的原因之一。
 */
describe('motion tokens sync with globals.css', () => {
  it('matches every duration value declared in :root', () => {
    for (const [name, seconds] of Object.entries(DURATION)) {
      const match = GLOBALS_CSS.match(
        new RegExp(`--duration-${name}:\\s*(\\d+(?:\\.\\d+)?)ms`),
      )
      expect(match, `globals.css 缺少 --duration-${name}`).not.toBeNull()
      expect(Number(match?.[1]) / 1000).toBeCloseTo(seconds, 5)
    }
  })

  it('exports every duration through the Tailwind --transition-duration-* namespace', () => {
    // Tailwind v4 从 --transition-duration-* 读取；只写 --duration-* 生不出 class。
    for (const name of Object.keys(DURATION)) {
      expect(
        GLOBALS_CSS,
        `@theme 缺少 --transition-duration-${name}，duration-${name} class 不会存在`,
      ).toContain(`--transition-duration-${name}: var(--duration-${name});`)
    }
  })

  it('matches every cubic-bezier control point declared in :root', () => {
    for (const [name, points] of Object.entries(EASE)) {
      const match = GLOBALS_CSS.match(
        new RegExp(`--ease-${name}:\\s*cubic-bezier\\(([^)]+)\\)`),
      )
      expect(match, `globals.css 缺少 --ease-${name}`).not.toBeNull()
      const cssPoints = (match?.[1] ?? '')
        .split(',')
        .map((part) => Number(part.trim()))
      expect(cssPoints).toEqual([...points])
    }
  })
})

describe('spatial spring tokens', () => {
  it('declares every spring as a duration-based spatial spring', () => {
    for (const [name, spring] of Object.entries(SPRINGS)) {
      expect(spring.type, `${name} 必须是 spring`).toBe('spring')
      // visualDuration + bounce 而非 stiffness/damping，见 tokens.ts 注释。
      expect(spring.visualDuration, `${name} 缺少 visualDuration`).toBeGreaterThan(0)
      expect(spring.stiffness, `${name} 不应使用物理参数`).toBeUndefined()
      expect(spring.damping, `${name} 不应使用物理参数`).toBeUndefined()
    }
  })

  it('keeps bounce within the reviewed ceiling', () => {
    for (const [name, spring] of Object.entries(SPRINGS)) {
      expect(spring.bounce, `${name} 缺少 bounce`).toBeDefined()
      expect(spring.bounce, `${name} 的 bounce 超过上限`).toBeLessThanOrEqual(
        SPRING_BOUNCE_MAX,
      )
    }
  })

  it('scales bounce inversely to surface size', () => {
    // 小控件弹一点有生气，大面积 overshoot 会被放大成果冻感（规范 §2.4）。
    expect(SPRING_SPATIAL_FAST.bounce).toBeGreaterThan(
      SPRING_SPATIAL_DEFAULT.bounce ?? 0,
    )
    expect(SPRING_SPATIAL_DEFAULT.bounce).toBeGreaterThan(
      SPRING_SPATIAL_SLOW.bounce ?? 0,
    )
  })

  it('increases visual duration with surface size', () => {
    expect(SPRING_SPATIAL_FAST.visualDuration).toBeLessThan(
      SPRING_SPATIAL_DEFAULT.visualDuration ?? 0,
    )
    expect(SPRING_SPATIAL_DEFAULT.visualDuration).toBeLessThan(
      SPRING_SPATIAL_SLOW.visualDuration ?? 0,
    )
  })

  it('never applies spring to exit motion', () => {
    // 退出 overshoot 会让人以为元素要回来（规范 §5.3）。
    expect(TRANSITION_EXIT.type).toBeUndefined()
    expect(TRANSITION_EXIT.ease).toEqual(EASE.exit)
  })
})
