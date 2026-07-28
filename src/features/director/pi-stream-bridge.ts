import 'server-only'
import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core'
import { streamBus } from '@/lib/stream/stream-bus'
import type { DirectorAgentMessage } from './pi-output'
import {
  assistantVisibleText,
  stripHiddenReasoning,
  toDirectorMessages,
} from './pi-messages'

export interface DirectorRunBridge {
  /** 订阅 Agent 生命周期事件的监听器。 */
  listener: (event: AgentEvent) => Promise<void>
  /** 开始新一轮 run：清空本轮消息与已推送文本游标。 */
  beginRun(): void
  /** 本轮（不含恢复历史）产生的消息，按输出提取器契约投影。 */
  runMessages(): DirectorAgentMessage[]
}

/**
 * Agent 事件桥：
 * - `message_update` 计算 assistant 可见文本的前缀差值，只把增量推给流总线；
 * - `message_end` 把消息脱敏后追加到 JSONL 会话，并记入本轮消息。
 */
export function createDirectorRunBridge(input: {
  streamKey: string
  appendMessage: (message: AgentMessage) => Promise<unknown>
}): DirectorRunBridge {
  let streamedText = ''
  let messages: AgentMessage[] = []

  return {
    beginRun() {
      streamedText = ''
      messages = []
    },
    runMessages() {
      return toDirectorMessages(messages)
    },
    listener: async (event) => {
      if (event.type === 'message_update') {
        const delta = nextDelta(streamedText, assistantVisibleText(event.message))
        if (delta.length === 0) return
        streamedText += delta
        streamBus.publish(input.streamKey, delta)
        return
      }
      if (event.type === 'message_end') {
        messages.push(event.message)
        await input.appendMessage(stripHiddenReasoning(event.message))
      }
    },
  }
}

/**
 * 流式增量是"当前完整文本"的快照序列，因此取前缀差；
 * 若供应商重写了整段文本（不再以已推送内容开头），则把新文本整体作为增量。
 */
function nextDelta(streamed: string, current: string): string {
  if (current.length === 0) return ''
  if (current === streamed) return ''
  return current.startsWith(streamed) ? current.slice(streamed.length) : current
}
