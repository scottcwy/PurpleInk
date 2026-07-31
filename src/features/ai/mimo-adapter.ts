import 'server-only'
import {
  getMimoConfig,
  type MimoSettingsInput,
} from './mimo-config'

export type MimoCredentialValidation =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'token-plan-not-for-backend'
        | 'invalid-key-format'
        | 'provider-failed'
      status?: number
    }

export function validateMimoCredentialFormat(
  apiKey: string
): MimoCredentialValidation {
  const normalized = apiKey.trim()
  if (normalized.startsWith('tp-')) {
    return { ok: false, reason: 'token-plan-not-for-backend' }
  }
  if (!normalized.startsWith('sk-') || normalized.length <= 3) {
    return { ok: false, reason: 'invalid-key-format' }
  }
  return { ok: true }
}

export async function validateMimoKey(
  apiKey: string,
  overrides: MimoSettingsInput = {},
  fetcher: typeof fetch = fetch
): Promise<MimoCredentialValidation> {
  const format = validateMimoCredentialFormat(apiKey)
  if (!format.ok) return format
  const current = await getMimoConfig()
  const baseUrl = nonEmpty(overrides.baseUrl) ?? current.baseUrl
  const model = nonEmpty(overrides.textModel) ?? current.textModel
  try {
    const response = await fetcher(
      `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'api-key': apiKey.trim(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_completion_tokens: 1,
        }),
        signal: AbortSignal.timeout(15_000),
      }
    )
    if (!response.ok) {
      return {
        ok: false,
        reason: 'provider-failed',
        status: response.status,
      }
    }
    await response.json()
    return { ok: true }
  } catch {
    return { ok: false, reason: 'provider-failed' }
  }
}

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}
