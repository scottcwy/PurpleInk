import { describe, expect, it, vi } from 'vitest'
import type { CanvasGraphNode, NodeStatus } from '@/features/canvas'
import type { ContextMenuItem } from '@/components/ui/context-menu'
import {
  buildNodeMenuItems,
  buildPaneMenuItems,
} from './canvas-context-menu-items'

function node(overrides: Partial<CanvasGraphNode> = {}): CanvasGraphNode {
  return {
    id: 'node-1',
    type: 'shot-codegen',
    status: 'success',
    stage: 'FABRICATE',
    contentHash: null,
    data: {},
    laneKey: 'shot-001',
    laneRole: null,
    artifacts: [],
    ...overrides,
  }
}

function item(items: ContextMenuItem[], id: string) {
  const found = items.find((entry) => entry.id === id)
  if (!found || found.type === 'separator') throw new Error(`缺少菜单项 ${id}`)
  return found
}

const handlers = {
  onRerender: vi.fn(),
  onStop: vi.fn(),
  onCancel: vi.fn(),
}

describe('buildNodeMenuItems', () => {
  it('exposes exactly 重新渲染 / 停止 / 取消', () => {
    const items = buildNodeMenuItems(node(), handlers)
    expect(
      items.filter((entry) => entry.type !== 'separator').map((entry) => entry.label),
    ).toEqual(['重新渲染', '停止', '取消'])
  })

  it('enables 重新渲染 on terminal statuses', () => {
    for (const status of ['success', 'failed', 'stale', 'skipped', 'idle'] as NodeStatus[]) {
      expect(item(buildNodeMenuItems(node({ status }), handlers), 'rerender').disabled).toBe(
        false,
      )
    }
  })

  it('blocks 重新渲染 while queued, running or blocked and states the reason', () => {
    for (const status of ['pending', 'running', 'blocked'] as NodeStatus[]) {
      const rerender = item(buildNodeMenuItems(node({ status }), handlers), 'rerender')
      expect(rerender.disabled).toBe(true)
      expect(rerender.disabledReason).toBeTruthy()
    }
  })

  it('blocks 重新渲染 while a submission is in flight', () => {
    expect(item(buildNodeMenuItems(node(), handlers, true), 'rerender').disabled).toBe(true)
  })

  it('enables 停止 only when the node has a cancellable provider wait', () => {
    const waiting = node({
      status: 'pending',
      executionNotice: {
        code: 'PROVIDER_RATE_LIMITED',
        message: '已达上游限流',
        resumeAt: '2026-07-30T00:00:00.000Z',
      },
    })
    expect(item(buildNodeMenuItems(waiting, handlers), 'stop').disabled).toBe(false)

    const idle = item(buildNodeMenuItems(node(), handlers), 'stop')
    expect(idle.disabled).toBe(true)
    expect(idle.disabledReason).toBe('无等待可取消')
  })

  it('keeps 取消 always available and side-effect free', () => {
    const cancel = item(buildNodeMenuItems(node({ status: 'running' }), handlers, true), 'cancel')
    expect(cancel.disabled).toBeUndefined()
    cancel.onSelect()
    expect(handlers.onCancel).toHaveBeenCalled()
  })
})

const paneHandlers = {
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onFitView: vi.fn(),
  onToggleFullscreen: vi.fn(),
}

const paneState = {
  minZoomReached: false,
  maxZoomReached: false,
  isFullscreen: false,
  fullscreenSupported: true,
}

describe('buildPaneMenuItems', () => {
  it('exposes 放大 / 缩小 / 适应视图 / 全屏模式', () => {
    expect(
      buildPaneMenuItems(paneState, paneHandlers)
        .filter((entry) => entry.type !== 'separator')
        .map((entry) => entry.label),
    ).toEqual(['放大', '缩小', '适应视图', '全屏模式'])
  })

  it('mirrors the viewport toolbar zoom bounds', () => {
    const atMax = buildPaneMenuItems({ ...paneState, maxZoomReached: true }, paneHandlers)
    expect(item(atMax, 'zoom-in').disabled).toBe(true)
    expect(item(atMax, 'zoom-out').disabled).toBe(false)

    const atMin = buildPaneMenuItems({ ...paneState, minZoomReached: true }, paneHandlers)
    expect(item(atMin, 'zoom-out').disabled).toBe(true)
  })

  it('flips the fullscreen label and disables it when unsupported', () => {
    expect(
      item(buildPaneMenuItems({ ...paneState, isFullscreen: true }, paneHandlers), 'fullscreen')
        .label,
    ).toBe('退出全屏')

    const unsupported = item(
      buildPaneMenuItems({ ...paneState, fullscreenSupported: false }, paneHandlers),
      'fullscreen',
    )
    expect(unsupported.disabled).toBe(true)
    expect(unsupported.disabledReason).toBe('浏览器不支持')
  })
})
