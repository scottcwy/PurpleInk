import { describe, expect, it } from 'vitest'
import {
  appendUniqueItems,
  groupItemsByKind,
  projectCardMetaText,
  sortKindsByCount,
  type ProjectCardItem,
} from './project-cards-client'

function item(overrides: Partial<ProjectCardItem>): ProjectCardItem {
  return {
    id: '1',
    kind: 'script',
    title: '示例项目',
    status: 'rendered',
    shotCount: 3,
    sourceSummary: '示例文稿',
    updatedAtIso: '2026-07-30T02:00:00.000Z',
    updatedLabel: '2026/7/30 10:00:00',
    ...overrides,
  }
}

describe('sortKindsByCount', () => {
  it('puts the kind with the most projects first', () => {
    expect(sortKindsByCount({ script: 1, audio: 5, website: 2 })).toEqual([
      'audio',
      'website',
      'script',
    ])
  })

  it('keeps the fixed script → audio → website order on ties', () => {
    expect(sortKindsByCount({ script: 2, audio: 2, website: 2 })).toEqual([
      'script',
      'audio',
      'website',
    ])
  })
})

describe('appendUniqueItems', () => {
  it('appends the next page and drops duplicated ids', () => {
    const existing = [item({ id: 'a' }), item({ id: 'b' })]
    const incoming = [item({ id: 'b' }), item({ id: 'c' })]
    expect(appendUniqueItems(existing, incoming).map((entry) => entry.id)).toEqual(
      ['a', 'b', 'c'],
    )
  })
})

describe('groupItemsByKind', () => {
  it('splits mixed search results into the three kinds', () => {
    const grouped = groupItemsByKind([
      item({ id: 'a', kind: 'website' }),
      item({ id: 'b', kind: 'script' }),
      item({ id: 'c', kind: 'website' }),
    ])
    expect(grouped.script.map((entry) => entry.id)).toEqual(['b'])
    expect(grouped.audio).toEqual([])
    expect(grouped.website.map((entry) => entry.id)).toEqual(['a', 'c'])
  })
})

describe('projectCardMetaText', () => {
  it('keeps the legacy meta wording per kind', () => {
    expect(projectCardMetaText(item({ kind: 'script', shotCount: 6 }))).toBe(
      '文稿 · 6 个镜头 · 2026/7/30 10:00:00',
    )
    expect(projectCardMetaText(item({ kind: 'audio', shotCount: 2 }))).toBe(
      '原录音 · 2 个镜头 · 2026/7/30 10:00:00',
    )
    expect(projectCardMetaText(item({ kind: 'website' }))).toBe(
      '网站介绍 · 2026/7/30 10:00:00',
    )
  })
})
