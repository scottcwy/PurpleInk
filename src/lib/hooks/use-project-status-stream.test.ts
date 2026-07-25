import { describe, expect, it } from 'vitest'
import {
  applyStreamEvent,
  INITIAL_STREAM_STATE,
} from './use-project-status-stream'

describe('applyStreamEvent（项目状态流纯归约）', () => {
  it('snapshot 全量替换覆盖层、置 connected 并重置 seq 水位', () => {
    const dirty = applyStreamEvent(INITIAL_STREAM_STATE, {
      kind: 'node-status',
      seq: 1,
      nodeId: 'stale-node',
      status: 'running',
    })
    const state = applyStreamEvent(dirty, {
      kind: 'snapshot',
      seq: 5,
      statuses: { n1: 'running', n2: 'success' },
    })

    expect([...state.statuses.entries()]).toEqual([
      ['n1', 'running'],
      ['n2', 'success'],
    ])
    expect(state.statuses.has('stale-node')).toBe(false)
    expect(state.baselineSeq).toBe(5)
    expect(state.connected).toBe(true)
  })

  it('node-status 按 seq 去重：不高于水位的迟到事件丢弃', () => {
    const base = applyStreamEvent(INITIAL_STREAM_STATE, {
      kind: 'snapshot',
      seq: 5,
      statuses: { n1: 'running' },
    })
    const late = applyStreamEvent(base, {
      kind: 'node-status',
      seq: 5,
      nodeId: 'n1',
      status: 'pending',
    })
    expect(late).toBe(base)

    const fresh = applyStreamEvent(base, {
      kind: 'node-status',
      seq: 6,
      nodeId: 'n1',
      status: 'success',
    })
    expect(fresh.statuses.get('n1')).toBe('success')
  })

  it('node-status 是 upsert：未知节点直接加入覆盖层（扇出兜底信号）', () => {
    const state = applyStreamEvent(INITIAL_STREAM_STATE, {
      kind: 'node-status',
      seq: 1,
      nodeId: 'brand-new',
      status: 'pending',
    })
    expect(state.statuses.get('brand-new')).toBe('pending')
  })

  it('topology 只递增 tick，不动覆盖层', () => {
    const base = applyStreamEvent(INITIAL_STREAM_STATE, {
      kind: 'snapshot',
      seq: 1,
      statuses: { n1: 'running' },
    })
    const state = applyStreamEvent(base, { kind: 'topology' })

    expect(state.topologyTick).toBe(1)
    expect(state.statuses).toEqual(base.statuses)
  })

  it('connection-error 置 connected=false，重连 snapshot 恢复（断线重连闭环）', () => {
    const live = applyStreamEvent(INITIAL_STREAM_STATE, {
      kind: 'snapshot',
      seq: 3,
      statuses: { n1: 'running' },
    })
    const dropped = applyStreamEvent(live, { kind: 'connection-error' })
    expect(dropped.connected).toBe(false)
    // 断线期间覆盖层保留（比 props 新，仍可显示）。
    expect(dropped.statuses.get('n1')).toBe('running')

    const recovered = applyStreamEvent(dropped, {
      kind: 'snapshot',
      seq: 9,
      statuses: { n1: 'success' },
    })
    expect(recovered.connected).toBe(true)
    expect(recovered.statuses.get('n1')).toBe('success')
    expect(recovered.baselineSeq).toBe(9)
  })
})
