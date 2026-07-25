export interface DirectorAgentContentItem {
  type: string
  text?: string
  id?: string
  name?: string
  arguments?: unknown
}

export type DirectorAgentMessage =
  | {
      role: 'assistant'
      content: readonly DirectorAgentContentItem[]
      timestamp?: number
    }
  | {
      role: 'toolResult'
      toolName: string
      toolCallId: string
      isError: boolean
      details?: unknown
    }

export type DirectorOutputPolicy =
  | { kind: 'assistant-text' }
  | {
      kind: 'validated-tool-argument'
      toolName: string
      argumentKey: string
    }

export interface DirectorOutput {
  artifactContent: string
  displayText: string
  provenance:
    | { kind: 'assistant-text'; timestamp?: number }
    | { kind: 'tool-argument'; toolName: string; toolCallId: string }
}

class DirectorToolOutputError extends Error {
  readonly code = 'DIRECTOR_TOOL_OUTPUT_MISSING'

  constructor(toolName: string) {
    super(`Director Tool 输出缺失或无效：${toolName}`)
    this.name = 'DirectorToolOutputError'
  }
}

export function extractDirectorOutput(
  messages: readonly DirectorAgentMessage[],
  policy: DirectorOutputPolicy
): DirectorOutput {
  if (policy.kind === 'assistant-text') {
    const assistant = lastAssistantText(messages)
    if (!assistant) throw new Error('Director 未返回非空 assistant 文本')
    return {
      artifactContent: assistant.text,
      displayText: assistant.text,
      provenance: assistant.timestamp === undefined
        ? { kind: 'assistant-text' }
        : { kind: 'assistant-text', timestamp: assistant.timestamp },
    }
  }
  return extractValidatedToolArgument(messages, policy)
}

function extractValidatedToolArgument(
  messages: readonly DirectorAgentMessage[],
  policy: Extract<DirectorOutputPolicy, { kind: 'validated-tool-argument' }>
): DirectorOutput {
  const resultIndex = findValidatedResult(messages, policy.toolName)
  if (resultIndex < 0) throw new DirectorToolOutputError(policy.toolName)
  const result = messages[resultIndex]
  if (
    !result ||
    result.role !== 'toolResult' ||
    typeof result.toolCallId !== 'string'
  ) {
    throw new DirectorToolOutputError(policy.toolName)
  }
  const toolCall = findMatchingToolCall(
    messages.slice(0, resultIndex),
    result.toolCallId,
    policy.toolName
  )
  if (!toolCall) throw new DirectorToolOutputError(policy.toolName)
  const rawArguments: unknown = toolCall.arguments
  if (
    !isRecord(rawArguments) ||
    !Object.hasOwn(rawArguments, policy.argumentKey)
  ) {
    throw new DirectorToolOutputError(policy.toolName)
  }
  const artifactContent = serializeArgument(
    rawArguments[policy.argumentKey],
    policy.toolName
  )
  return {
    artifactContent,
    displayText: lastAssistantText(messages)?.text ?? '',
    provenance: {
      kind: 'tool-argument',
      toolName: policy.toolName,
      toolCallId: result.toolCallId,
    },
  }
}

function findValidatedResult(
  messages: readonly DirectorAgentMessage[],
  toolName: string
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (
      message?.role === 'toolResult' &&
      message.toolName === toolName &&
      message.isError === false
    ) {
      const details: unknown = message.details
      if (isRecord(details) && details.ok === true) return index
    }
  }
  return -1
}

function findMatchingToolCall(
  messages: readonly DirectorAgentMessage[],
  toolCallId: string,
  toolName: string
): { arguments: unknown } | undefined {
  const matches: Array<{ arguments: unknown }> = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const item of message.content ?? []) {
      if (
        item.type === 'toolCall' &&
        item.id === toolCallId &&
        item.name === toolName
      ) {
        const argumentsValue: unknown = item.arguments
        matches.push({ arguments: argumentsValue })
      }
    }
  }
  return matches.length === 1 ? matches[0] : undefined
}

function lastAssistantText(
  messages: readonly DirectorAgentMessage[]
): { text: string; timestamp?: number } | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant') continue
    const text = (message.content ?? [])
      .filter((item) => item.type === 'text')
      .map((item) => item.text ?? '')
      .join('')
      .trim()
    if (text.length === 0) continue
    return typeof message.timestamp === 'number'
      ? { text, timestamp: message.timestamp }
      : { text }
  }
  return undefined
}

function serializeArgument(value: unknown, toolName: string): string {
  if (typeof value === 'string') return value
  try {
    const serialized = JSON.stringify(value)
    if (typeof serialized === 'string') return serialized
  } catch {
    // 统一映射为稳定的业务错误，避免泄露原始 Tool 参数。
  }
  throw new DirectorToolOutputError(toolName)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
