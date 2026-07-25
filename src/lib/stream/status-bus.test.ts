import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusBus, type StatusBusEvent } from './status-bus'

vi.mock('server-only', () => ({}))

function collect(bus: StatusBus, projectId: string): StatusBusEvent[] {
  const events: StatusBusEvent[] = []
  bus.subscribe(projectId, (event) => events.push(event))
  return events
}

describe('StatusBus', () => {
  it('订阅立即回放快照，再广播后续 node-status', () => {
    const bus = new StatusBus()
    bus.publishStatus('p1', 'n1', 'pending')
    const events = collect(bus, 'p1')

    expect(events[0]).toEqual({
      type: 'snapshot',
      seq: 1,
      statuses: { n1: 'pending' },
    })

    bus.publishStatus('p1', 'n1', 'running')
    expect(events[1]).toEqual({
      type: 'node-status',
      seq: 2,
      nodeId: 'n1',
      status: 'running',
    })
  })

  it('同节点重复发布是最新值 upsert，快照只保留最后状态', () => {
    const bus = new StatusBus()
    bus.publishStatus('p1', 'n1', 'pending')
    bus.publishStatus('p1', 'n1', 'running')
    bus.publishStatus('p1', 'n1', 'success')

    expect(bus.getSnapshot('p1')).toEqual({
      seq: 3,
      statuses: { n1: 'success' },
    })
  })

  it('seq 在项目内跨 node-status 与 topology 单调递增', () => {
    const bus = new StatusBus()
    const events = collect(bus, 'p1')
    bus.publishStatus('p1', 'n1', 'pending')
    bus.publishTopology('p1')
    bus.publishStatus('p1', 'n2', 'pending')

    const seqs = events
      .filter((event) => event.type !== 'snapshot')
      .map((event) => event.seq)
    expect(seqs).toEqual([1, 2, 3])
  })

  it('topology 事件不携带节点，只递增水位', () => {
    const bus = new StatusBus()
    const events = collect(bus, 'p1')
    bus.publishTopology('p1')

    expect(events.at(-1)).toEqual({ type: 'topology', seq: 1 })
    expect(bus.getSnapshot('p1').statuses).toEqual({})
  })

  it('按项目隔离，互不串流', () => {
    const bus = new StatusBus()
    const a = collect(bus, 'pa')
    const b = collect(bus, 'pb')
    bus.publishStatus('pa', 'n1', 'running')

    expect(a.some((event) => event.type === 'node-status')).toBe(true)
    expect(b.some((event) => event.type === 'node-status')).toBe(false)
  })

  it('订阅只读动作不创建缓冲：空项目回放 seq 0 空快照', () => {
    const bus = new StatusBus()
    const events = collect(bus, 'p1')

    expect(events).toEqual([{ type: 'snapshot', seq: 0, statuses: {} }])
    expect(bus.getSnapshot('p1')).toEqual({ seq: 0, statuses: {} })
  })

  it('退订后不再收到广播', () => {
    const bus = new StatusBus()
    const events: StatusBusEvent[] = []
    const unsubscribe = bus.subscribe('p1', (event) => events.push(event))
    const countAfterSnapshot = events.length
    unsubscribe()
    bus.publishStatus('p1', 'n1', 'pending')

    expect(events.length).toBe(countAfterSnapshot)
  })

  it('单个订阅者抛错不影响其它订阅者', () => {
    const bus = new StatusBus()
    const received: StatusBusEvent[] = []
    bus.subscribe('p1', () => {
      throw new Error('订阅者故障')
    })
    bus.subscribe('p1', (event) => received.push(event))
    bus.publishStatus('p1', 'n1', 'running')

    expect(received.some((event) => event.type === 'node-status')).toBe(true)
  })

  describe('末位订阅者清理', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('退订 30s 后清理缓冲，seq 归零；有新订阅者则保留', () => {
      const bus = new StatusBus()
      bus.publishStatus('p1', 'n1', 'success')
      const unsubscribe = bus.subscribe('p1', () => {})
      unsubscribe()
      vi.advanceTimersByTime(30_000 + 1)

      expect(bus.getSnapshot('p1')).toEqual({ seq: 0, statuses: {} })

      bus.publishStatus('p2', 'n1', 'success')
      const keep = bus.subscribe('p2', () => {})
      const gone = bus.subscribe('p2', () => {})
      gone()
      vi.advanceTimersByTime(30_000 + 1)

      expect(bus.getSnapshot('p2').statuses).toEqual({ n1: 'success' })
      keep()
    })
  })
})
