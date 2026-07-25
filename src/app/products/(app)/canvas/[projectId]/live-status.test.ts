import { describe, expect, it } from 'vitest'
import type { PositionedCanvasNode } from '@/features/canvas'
import type { NodeStatusValue } from '@/lib/stream/status-bus'
import { applyStatusOverlay } from './live-status'

function node(id: string, status: PositionedCanvasNode['status']): PositionedCanvasNode {
  return {
    id,
    type: 'shot-script',
    status,
    stage: 'SHOT_SPEC',
    contentHash: null,
    data: { payload: {} },
    laneKey: 'S001',
    laneRole: 'shot-script',
    artifacts: [],
    position: { x: 0, y: 0 },
  }
}

function overlay(entries: Record<string, NodeStatusValue>): Map<string, NodeStatusValue> {
  return new Map(Object.entries(entries))
}

describe('applyStatusOverlay', () => {
  it('覆盖层逐节点替换 status，其余字段与引用不动', () => {
    const base = [node('n1', 'pending'), node('n2', 'idle')]
    const result = applyStatusOverlay(base, overlay({ n1: 'running' }))

    expect(result.nodes[0]!.status).toBe('running')
    expect(result.nodes[0]!.position).toEqual({ x: 0, y: 0 })
    // 未被覆盖的节点保持原引用（memo 友好）。
    expect(result.nodes[1]).toBe(base[1])
  })

  it('覆盖层与 props 一致时保持原引用', () => {
    const base = [node('n1', 'running')]
    const result = applyStatusOverlay(base, overlay({ n1: 'running' }))

    expect(result.nodes[0]).toBe(base[0])
    expect(result.terminalDrift).toBe(false)
  })

  it('覆盖层含 props 中不存在的 nodeId 时给出扇出兜底信号', () => {
    const result = applyStatusOverlay(
      [node('n1', 'running')],
      overlay({ n1: 'running', 'new-lane-node': 'pending' })
    )

    expect(result.unknownNodeIds).toEqual(['new-lane-node'])
  })

  it('节点被覆盖层推进到 props 尚未见到的终态时置 terminalDrift', () => {
    const result = applyStatusOverlay(
      [node('n1', 'running')],
      overlay({ n1: 'success' })
    )

    expect(result.nodes[0]!.status).toBe('success')
    expect(result.terminalDrift).toBe(true)
  })

  it('props 已是终态（refresh 已跟上）不再报 terminalDrift', () => {
    const result = applyStatusOverlay(
      [node('n1', 'failed')],
      overlay({ n1: 'failed' })
    )

    expect(result.terminalDrift).toBe(false)
  })

  it('终态到终态的迁移（failed -> pending 重跑前无此情况）不误报', () => {
    // stale 不属于终态集合：success -> stale 属于非终态方向，不触发 drift。
    const result = applyStatusOverlay(
      [node('n1', 'success')],
      overlay({ n1: 'stale' })
    )

    expect(result.nodes[0]!.status).toBe('stale')
    expect(result.terminalDrift).toBe(false)
  })
})
