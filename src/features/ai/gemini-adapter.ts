import 'server-only'
import { getGeminiConfig, type GeminiSettingsInput } from './gemini-config'

/** 用候选配置执行最小真实补全探测（fetch 直连 OpenAI 兼容端点）；失败只记录无 Key 的服务端诊断。 */
export async function validateGeminiKey(
  apiKey: string,
  overrides: GeminiSettingsInput = {},
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const current = await getGeminiConfig()
  const baseUrl = nonEmpty(overrides.baseUrl) ?? current.baseUrl
  const model = nonEmpty(overrides.primaryModel) ?? current.primaryModel
  try {
    const response = await fetcher(
      `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (!response.ok) {
      console.error('[gemini] validateGeminiKey 失败', {
        status: response.status,
        errorType: 'HttpError',
      })
      return false
    }
    await response.json()
    return true
  } catch (error) {
    const errorType = error instanceof Error ? error.name : 'UnknownError'
    console.error('[gemini] validateGeminiKey 失败', {
      status: undefined,
      errorType,
    })
    return false
  }
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
