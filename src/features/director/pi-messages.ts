import 'server-only'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { DirectorAgentMessage } from './pi-output'

/**
 * 会话消息的形状转换与脱敏。
 *
 * 两个不可让步的口径：
 * 1. `thinking`（隐藏推理）绝不落盘、绝不进流式输出；
 * 2. 输出提取只看本轮消息，历史消息不参与，避免复用上一轮的 Tool 结果。
 */

/** 落盘前剥掉隐藏推理；其它内容原样保留以维持多轮上下文。 */
export function stripHiddenReasoning(message: AgentMessage): AgentMessage {
  if (message.role !== 'assistant') return message
  const content = message.content.filter((item) => item.type !== 'thinking')
  return content.length === message.content.length
    ? message
    : { ...message, content }
}

/** assistant 可见文本（不含 thinking / toolCall），用于流式增量与展示文本。 */
export function assistantVisibleText(message: AgentMessage): string {
  if (message.role !== 'assistant') return ''
  return message.content
    .map((item) => (item.type === 'text' ? item.text : ''))
    .join('')
}

/** 把 pi 消息投影成输出提取器的最小契约形状。 */
export function toDirectorMessages(
  messages: readonly AgentMessage[],
): DirectorAgentMessage[] {
  const projected: DirectorAgentMessage[] = []
  for (const message of messages) {
    if (message.role === 'assistant') {
      projected.push({
        role: 'assistant',
        content: message.content.map((item) => item.type === 'toolCall'
          ? { type: item.type, id: item.id, name: item.name, arguments: item.arguments }
          : { type: item.type, text: item.type === 'text' ? item.text : undefined }),
        timestamp: message.timestamp,
      })
      continue
    }
    if (message.role === 'toolResult') {
      projected.push({
        role: 'toolResult',
        toolName: message.toolName,
        toolCallId: message.toolCallId,
        isError: message.isError,
        details: message.details,
      })
    }
  }
  return projected
}
