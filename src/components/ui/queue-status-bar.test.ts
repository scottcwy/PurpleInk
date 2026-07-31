import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  describeQueueActivity,
  QueueStatusBar,
  type QueueActivity,
} from './queue-status-bar'

describe('describeQueueActivity', () => {
  it.each([
    [
      { completed: 2, active: 1, waiting: 0, failed: 2, total: 5 },
      '2 个节点失败',
    ],
    [
      { completed: 2, active: 1, waiting: 2, failed: 0, total: 5 },
      '2 个节点等待恢复',
    ],
    [
      { completed: 2, active: 1, waiting: 0, failed: 0, total: 5 },
      '1 个节点执行中',
    ],
    [
      { completed: 5, active: 0, waiting: 0, failed: 0, total: 5 },
      '全部节点已完成',
    ],
    [
      { completed: 0, active: 0, waiting: 0, failed: 0, total: 5 },
      '等待执行',
    ],
  ] satisfies Array<[QueueActivity, string]>)(
    '只由真实计数派生 %#',
    (input, expected) => {
      expect(describeQueueActivity(input)).toBe(expected)
    }
  )
})

describe('QueueStatusBar', () => {
  it('只在有活动节点时旋转 loader', () => {
    expect(renderQueue({ active: 0 })).not.toContain('animate-spin')
    expect(renderQueue({ active: 1 })).toContain('animate-spin')
  })

  it.each([
    [{ failed: 1 }, 'failed'],
    [{ waiting: 1 }, 'waiting'],
    [{ active: 1 }, 'active'],
    [{ completed: 3 }, 'complete'],
  ] as const)('为真实终态投影对应 SVG 状态 %#', (overrides, state) => {
    expect(renderQueue(overrides)).toContain(`data-state="${state}"`)
  })

  it('源码不包含固定 cache 命中文案', () => {
    const source = readFileSync(
      new URL('./queue-status-bar.tsx', import.meta.url),
      'utf8'
    )
    expect(source).not.toContain('命中缓存 5 次')
  })
})

function renderQueue(
  overrides: Partial<QueueActivity>,
): string {
  return renderToStaticMarkup(
    createElement(QueueStatusBar, {
      completed: 1,
      active: 0,
      waiting: 0,
      failed: 0,
      total: 3,
      ...overrides,
    })
  )
}
