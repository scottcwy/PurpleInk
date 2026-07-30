import { describe, expect, it, vi } from 'vitest'
import { buildProjectMenuItems } from './project-menu-items'

const handlers = {
  onOpen: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
}

describe('buildProjectMenuItems', () => {
  it('exposes exactly 打开 / 重命名 / 删除', () => {
    expect(
      buildProjectMenuItems(handlers)
        .filter((entry) => entry.type !== 'separator')
        .map((entry) => entry.label),
    ).toEqual(['打开', '重命名', '删除'])
  })

  it('marks only 删除 as a destructive action and keeps every item enabled', () => {
    for (const entry of buildProjectMenuItems(handlers)) {
      if (entry.type === 'separator') continue
      expect(entry.disabled).toBeUndefined()
      expect(entry.danger ?? false).toBe(entry.id === 'delete')
      // 每项都必须带图标，状态不只靠颜色表达。
      expect(entry.icon).toBeDefined()
    }
  })

  it('routes each item to its own handler', () => {
    const items = buildProjectMenuItems(handlers)
    for (const entry of items) {
      if (entry.type !== 'separator') entry.onSelect()
    }
    expect(handlers.onOpen).toHaveBeenCalledTimes(1)
    expect(handlers.onRename).toHaveBeenCalledTimes(1)
    expect(handlers.onDelete).toHaveBeenCalledTimes(1)
  })
})
