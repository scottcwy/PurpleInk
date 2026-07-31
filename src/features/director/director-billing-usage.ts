import type {
  AssistantMessage,
  Context,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai'
import type { ManagedUsage } from '@/features/ai'

interface DirectorUsageInput {
  context: Context
  options?: SimpleStreamOptions
  runtime: { maxOutputTokens: number }
}

export function reportedTextUsage(
  message: AssistantMessage,
): ManagedUsage | null {
  const usage = message.usage
  const values = [
    usage.input,
    usage.output,
    usage.cacheRead,
    usage.cacheWrite,
  ]
  if (!values.every(isUsageNumber)) return null
  if (values.every((value) => value === 0)) return null
  return {
    kind: 'text',
    inputTokens: usage.input,
    cachedInputTokens: usage.cacheRead,
    cacheWriteInputTokens: usage.cacheWrite,
    outputTokens: usage.output,
  }
}

export function estimatedTokens(input: DirectorUsageInput): number {
  return estimatedInputTokens(input)
    + (input.options?.maxTokens ?? input.runtime.maxOutputTokens)
}

export function estimatedTextUsage(
  input: DirectorUsageInput,
  message: AssistantMessage,
): ManagedUsage {
  return {
    kind: 'text',
    inputTokens: estimatedInputTokens(input),
    cachedInputTokens: 0,
    outputTokens: Math.ceil(JSON.stringify(message.content).length / 4),
  }
}

function estimatedInputTokens(input: DirectorUsageInput): number {
  const inputCharacters = JSON.stringify({
    systemPrompt: input.context.systemPrompt,
    messages: input.context.messages,
    tools: input.context.tools ?? [],
  }).length
  return Math.ceil(inputCharacters / 4)
}

function isUsageNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}
