import { describe, expect, it } from 'vitest'
import { CANVAS_NODE_TYPES } from '@/lib/db/schema/canvas'
import {
  SKIP_REASON_MAX_LENGTH,
  SKIP_REASON_MIN_LENGTH,
  SKIP_KIND,
  SKIPPABLE,
  SKIPPABLE_FROM_STATUSES,
  isSkippableFromStatus,
  isSkippableNodeType,
  skipKindForNodeType,
} from './skip-policy'

describe('SKIPPABLE 全集映射（模式 C 护栏）', () => {
  it('键集合与 CanvasNodeType 全集完全一致（新增节点类型必须显式决策）', () => {
    expect(Object.keys(SKIPPABLE).sort()).toEqual([...CANVAS_NODE_TYPES].sort())
  })

  it('只有可被降级交付诚实表达的 shot 环节可跳过', () => {
    const skippable = CANVAS_NODE_TYPES.filter((type) => isSkippableNodeType(type))
    expect(skippable.sort()).toEqual([
      'shot-codegen',
      'shot-qa',
      'shot-sfx',
      'shot-subtitle',
    ])
  })

  it.each([...CANVAS_NODE_TYPES])('%s 的跳过决策是显式布尔', (type) => {
    expect(typeof SKIPPABLE[type]).toBe('boolean')
  })

  it('跳过类型全集映射区分媒体降级与验收豁免', () => {
    expect(Object.keys(SKIP_KIND).sort()).toEqual([...CANVAS_NODE_TYPES].sort())
    expect(skipKindForNodeType('shot-codegen')).toBe('output-degradation')
    expect(skipKindForNodeType('shot-qa')).toBe('qa-waiver')
    expect(skipKindForNodeType('score')).toBeNull()
  })
})

describe('可跳过来源状态', () => {
  it('仅 failed / stale / cancelled 允许人为跳过', () => {
    expect([...SKIPPABLE_FROM_STATUSES].sort()).toEqual([
      'cancelled',
      'failed',
      'stale',
    ])
  })

  it.each(['idle', 'pending', 'running', 'success', 'skipped'] as const)(
    '%s 状态不允许发起跳过',
    (status) => {
      expect(isSkippableFromStatus(status)).toBe(false)
    }
  )
})

describe('跳过原因长度合同', () => {
  it('与 routing.md 登记一致：1-200 字', () => {
    expect(SKIP_REASON_MIN_LENGTH).toBe(1)
    expect(SKIP_REASON_MAX_LENGTH).toBe(200)
  })
})
