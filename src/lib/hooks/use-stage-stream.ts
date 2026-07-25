'use client'

import { useEffect, useState } from 'react'

export interface StageStreamError {
  stage: string
  message: string
}

export interface StageStreamState {
  /** 已累积的流式文本（真实来自 Pi Agent 逐 token 输出）。 */
  text: string
  /** 是否仍在流式产出中。 */
  streaming: boolean
  /** 已产出字符数（真实计数，非估算）。 */
  charCount: number
  /** 内存缓冲是否被截断（超长流）。 */
  truncated: boolean
  /** 阶段失败的结构化错误（来自 SSE error 事件 / 持久化 directorError）。 */
  error?: StageStreamError
}

/** 内部态：附带连接键，用于在节点/状态切换时以派生方式复位（不在 effect 内同步 setState）。 */
interface KeyedState extends StageStreamState {
  key: string
}

const INITIAL: StageStreamState = {
  text: '',
  streaming: false,
  charCount: 0,
  truncated: false,
}

const INITIAL_KEYED: KeyedState = { ...INITIAL, key: '' }

interface SnapshotPayload {
  text: string
  done: boolean
  error: StageStreamError | null
  truncated: boolean
}

/**
 * 订阅某节点阶段的实时流式输出（SSE）。
 *
 * - 仅在节点非 idle/pending 时建立 `EventSource`；否则返回初始态。
 * - 复位以「派生」实现：切换节点/状态时连接键变化，渲染直接返回 INITIAL，
 *   直到新连接的 snapshot 回调写入带新键的态——故 effect 体内不做同步 setState，
 *   全部 setState 均发生在 EventSource 订阅回调中。
 * - running 期间 status 稳定，1.5s `router.refresh` 不改变 props，不引发无关重连。
 */
export function useStageStream(
  projectId: string,
  nodeId: string | undefined,
  status: string,
): StageStreamState {
  const [state, setState] = useState<KeyedState>(INITIAL_KEYED)
  const eligible = !!nodeId && status !== 'idle' && status !== 'pending'
  const connKey = eligible ? `${projectId}:${nodeId}:${status}` : ''

  useEffect(() => {
    if (!eligible || !nodeId) return
    const key = `${projectId}:${nodeId}:${status}`
    const url = `/api/director/stream/${encodeURIComponent(nodeId)}?projectId=${encodeURIComponent(projectId)}`
    const source = new EventSource(url)
    let text = ''

    const patch = (next: Partial<StageStreamState>): void =>
      setState((prev) =>
        prev.key === key ? { ...prev, ...next } : { ...INITIAL_KEYED, key, ...next },
      )

    source.addEventListener('snapshot', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as SnapshotPayload
      text = data.text
      patch({
        text,
        charCount: text.length,
        truncated: data.truncated,
        streaming: !data.done,
        error: data.error ?? undefined,
      })
      // 快照已是终态：主动关闭（双保险，服务端 finish + done 事件之外）。
      if (data.done) source.close()
    })

    source.addEventListener('delta', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { text: string }
      text += data.text
      patch({ text, charCount: text.length, streaming: true })
    })

    source.addEventListener('done', () => {
      patch({ streaming: false })
      source.close()
    })

    source.addEventListener('error', (event) => {
      const raw = (event as MessageEvent).data
      if (typeof raw === 'string' && raw.length > 0) {
        try {
          const err = JSON.parse(raw) as StageStreamError
          patch({ streaming: false, error: err })
          source.close()
          return
        } catch {
          // 非我们发出的 error 帧，落到连接层默认处理。
        }
      }
      // 连接层错误（无 data）：运行中交由 EventSource 自动重连 + 服务端 snapshot 续传。
    })

    return () => source.close()
  }, [eligible, projectId, nodeId, status])

  if (!eligible || state.key !== connKey) return INITIAL
  return {
    text: state.text,
    streaming: state.streaming,
    charCount: state.charCount,
    truncated: state.truncated,
    error: state.error,
  }
}
