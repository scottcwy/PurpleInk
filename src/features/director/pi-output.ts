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
      /**
       * 工具未提交可用实参时，从 assistant 文本抢救等价产物内容的可信校验器。
       * 返回 `null` 表示文本不合规，提取仍按缺失失败。不提供时完全不做抢救。
       */
      recover?: (assistantText: string) => string | null
    }

export interface DirectorOutput {
  artifactContent: string
  displayText: string
  provenance:
    | { kind: 'assistant-text'; timestamp?: number }
    | { kind: 'tool-argument'; toolName: string; toolCallId: string }
    | { kind: 'assistant-text-recovery'; toolName: string }
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

type ToolArgumentPolicy = Extract<
  DirectorOutputPolicy,
  { kind: 'validated-tool-argument' }
>

function extractValidatedToolArgument(
  messages: readonly DirectorAgentMessage[],
  policy: ToolArgumentPolicy
): DirectorOutput {
  return (
    fromValidatedToolCall(messages, policy) ??
    fromRecoveredAssistantText(messages, policy) ??
    raiseMissing(policy.toolName)
  )
}

function fromValidatedToolCall(
  messages: readonly DirectorAgentMessage[],
  policy: ToolArgumentPolicy
): DirectorOutput | null {
  const resultIndex = findValidatedResult(messages, policy.toolName)
  if (resultIndex < 0) return null
  const result = messages[resultIndex]
  if (
    !result ||
    result.role !== 'toolResult' ||
    typeof result.toolCallId !== 'string'
  ) {
    return null
  }
  const toolCall = findMatchingToolCall(
    messages.slice(0, resultIndex),
    result.toolCallId,
    policy.toolName
  )
  if (!toolCall) return null
  const rawArguments: unknown = toolCall.arguments
  if (
    !isRecord(rawArguments) ||
    !Object.hasOwn(rawArguments, policy.argumentKey)
  ) {
    return null
  }
  const artifactContent = serializeArgument(rawArguments[policy.argumentKey])
  if (artifactContent === null) return null
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

/**
 * 模型把工具实参当作文本输出时的抢救路径。
 * 内容仍必须通过 policy 提供的可信校验器，否则按缺失失败——不降级门禁。
 */
function fromRecoveredAssistantText(
  messages: readonly DirectorAgentMessage[],
  policy: ToolArgumentPolicy
): DirectorOutput | null {
  if (!policy.recover) return null
  const assistant = lastAssistantText(messages)
  if (!assistant) return null
  const artifactContent = policy.recover(assistant.text)
  if (artifactContent === null) return null
  return {
    artifactContent,
    displayText: assistant.text,
    provenance: { kind: 'assistant-text-recovery', toolName: policy.toolName },
  }
}

function raiseMissing(toolName: string): never {
  throw new DirectorToolOutputError(toolName)
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

/** 不可序列化的实参返回 null，由调用方统一映射为缺失错误，避免泄露原始 Tool 参数。 */
function serializeArgument(value: unknown): string | null {
  if (typeof value === 'string') return value
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? serialized : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
