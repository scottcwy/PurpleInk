import type { AiClient, AiCompletionInput } from './openai-compatible'
import { AiProviderError } from './provider-error'
import { renderPromptAsset } from '../workflow/prompts'

interface ContractSchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues?: Array<{ code?: unknown; path?: unknown }> } }
}

export interface CompleteJsonWithRepairOptions<T> {
  ai: AiClient
  schema: ContractSchema<T>
  stage: string
  prompt: AiCompletionInput
}

export async function completeJsonWithRepair<T>(options: CompleteJsonWithRepairOptions<T>): Promise<T> {
  const first = await attemptContract(options.ai, options.prompt, options.schema)
  if (first.ok) return first.data

  const repair = renderPromptAsset('json-repair', {
    stage: compactText(options.stage, 120),
    errorSummary: first.summary,
    originalSystem: compactText(options.prompt.system, 1_500),
    originalUser: compactText(options.prompt.user, 2_000),
  })
  const second = await attemptContract(
    options.ai,
    { system: repair.system, user: repair.user, signal: options.prompt.signal },
    options.schema,
  )
  if (second.ok) return second.data
  throw new AiProviderError('AI_OUTPUT_INVALID', 'AI 输出在一次修复后仍不符合合同')
}

type ContractAttempt<T> = { ok: true; data: T } | { ok: false; summary: string }

async function attemptContract<T>(
  ai: AiClient,
  prompt: AiCompletionInput,
  schema: ContractSchema<T>,
): Promise<ContractAttempt<T>> {
  let value: unknown
  try {
    value = await ai.completeJson(prompt)
  } catch (error) {
    if (error instanceof AiProviderError && error.code === 'AI_OUTPUT_INVALID') {
      return { ok: false, summary: 'JSON_PARSE_INVALID' }
    }
    throw error
  }
  const parsed = schema.safeParse(value)
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, summary: summarizeIssues(parsed.error.issues) }
}

function summarizeIssues(issues: Array<{ code?: unknown; path?: unknown }> | undefined): string {
  if (!issues?.length) return 'SCHEMA_VALIDATION_FAILED'
  return compactText(
    issues
      .slice(0, 8)
      .map((issue) => {
        const path = Array.isArray(issue.path)
          ? issue.path.filter((part) => typeof part === 'string' || typeof part === 'number').join('.')
          : ''
        const code = typeof issue.code === 'string' ? issue.code : 'invalid'
        return `${path || '<root>'}:${code}`
      })
      .join(';'),
    800,
  )
}

function compactText(value: string, maximum: number): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum)
}
