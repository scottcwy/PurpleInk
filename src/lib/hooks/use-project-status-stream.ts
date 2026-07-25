'use client'

import { useEffect, useState } from 'react'
import type { NodeStatusValue } from '@/lib/stream/status-bus'

export interface ProjectStatusStreamState {
  /** SSE 覆盖层：nodeId -> 最新领域态（props 仍是全量真值基线）。 */
  statuses: ReadonlyMap<string, NodeStatusValue>
  /** 拓扑事件计数：变化即节点/边集合变了，消费方应 router.refresh()。 */
  topologyTick: number
  /** SSE 是否健康；false 时由兜底轮询接管。 */
  connected: boolean
}

/** 连线事件（与 /api/director/stream/project/[projectId] 的帧一一对应）。 */
export type ProjectStatusWireEvent =
  | { kind: 'snapshot'; seq: number; statuses: Record<string, NodeStatusValue> }
  | { kind: 'node-status'; seq: number; nodeId: string; status: NodeStatusValue }
  | { kind: 'topology' }
  | { kind: 'connection-error' }

interface StreamReducerState extends ProjectStatusStreamState {
  /** 本连接 snapshot 的 seq 水位；≤ 水位的迟到事件一律丢弃。 */
  baselineSeq: number
}

export const INITIAL_STREAM_STATE: StreamReducerState = {
  statuses: new Map(),
  topologyTick: 0,
  connected: false,
  baselineSeq: 0,
}

/**
 * 纯事件归约：snapshot 全量替换覆盖层并重置水位（重连自动对齐）；
 * node-status 按 seq 去重后 upsert；topology 只递增 tick；
 * connection-error 置 connected=false（重连成功由下一个 snapshot 恢复）。
 */
export function applyStreamEvent(
  state: StreamReducerState,
  event: ProjectStatusWireEvent
): StreamReducerState {
  switch (event.kind) {
    case 'snapshot':
      return {
        ...state,
        statuses: new Map(Object.entries(event.statuses)),
        baselineSeq: event.seq,
        connected: true,
      }
    case 'node-status': {
      if (event.seq <= state.baselineSeq) return state
      const statuses = new Map(state.statuses)
      statuses.set(event.nodeId, event.status)
      return { ...state, statuses }
    }
    case 'topology':
      return { ...state, topologyTick: state.topologyTick + 1 }
    case 'connection-error':
      return { ...state, connected: false }
  }
}

/** 内部态：附带连接键，切换项目/开关时以派生方式复位（不在 effect 内同步 setState）。 */
interface KeyedState extends StreamReducerState {
  key: string
}

const INITIAL_KEYED: KeyedState = { ...INITIAL_STREAM_STATE, key: '' }

const PUBLIC_INITIAL: ProjectStatusStreamState = {
  statuses: INITIAL_STREAM_STATE.statuses,
  topologyTick: 0,
  connected: false,
}

/**
 * 订阅项目级节点状态流（SSE）。
 *
 * - `enabled=false`（无活跃节点且非 autopilot）时不建连接——即「全终态后关闭」；
 * - 事件全部经 `applyStreamEvent` 纯归约，effect 体内不做同步 setState；
 * - 连接层错误交给 EventSource 自动重连，期间 `connected=false`，
 *   兜底轮询（canvas-view 原 1.5s 路径）据此接管，重连成功由 snapshot 恢复。
 */
export function useProjectStatusStream(
  projectId: string,
  enabled: boolean
): ProjectStatusStreamState {
  const [state, setState] = useState<KeyedState>(INITIAL_KEYED)
  const connKey = enabled ? projectId : ''

  useEffect(() => {
    if (!enabled) return
    const key = projectId
    const url = `/api/director/stream/project/${encodeURIComponent(projectId)}`
    const source = new EventSource(url)

    const dispatch = (event: ProjectStatusWireEvent): void =>
      setState((prev) => {
        const base = prev.key === key ? prev : { ...INITIAL_KEYED, key }
        return { ...applyStreamEvent(base, event), key }
      })

    source.addEventListener('snapshot', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as {
        seq: number
        statuses: Record<string, NodeStatusValue>
      }
      dispatch({ kind: 'snapshot', seq: data.seq, statuses: data.statuses })
    })
    source.addEventListener('node-status', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as {
        seq: number
        nodeId: string
        status: NodeStatusValue
      }
      dispatch({ kind: 'node-status', ...data })
    })
    source.addEventListener('topology', () => {
      dispatch({ kind: 'topology' })
    })
    source.onerror = () => {
      // 连接层错误：标记断开让兜底轮询接管，重连由 EventSource 自动完成。
      dispatch({ kind: 'connection-error' })
    }

    return () => source.close()
  }, [enabled, projectId])

  if (!enabled || state.key !== connKey) return PUBLIC_INITIAL
  return {
    statuses: state.statuses,
    topologyTick: state.topologyTick,
    connected: state.connected,
  }
}
