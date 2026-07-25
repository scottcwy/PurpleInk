import 'server-only'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import { getAiConfigDependencies, getStepfunConfig } from './config'

/** 读取加密保存的 StepFun Key（仅服务端；不回退 env）。 */
export async function getStoredApiKey(): Promise<string | null> {
  return getAiConfigDependencies().credentials.loadSecret(
    LOCAL_WORKSPACE_ID,
    'stepfun',
  )
}

/** 保存 StepFun Key（仅服务端；永不进前端 bundle）。 */
export async function saveApiKey(
  apiKey: string,
  verifiedAt = new Date(),
): Promise<void> {
  await getAiConfigDependencies().credentials.save({
    workspaceId: LOCAL_WORKSPACE_ID,
    provider: 'stepfun',
    secret: apiKey,
    verifiedAt,
  })
}

/** 校验 Key 是否可用（fetch 直连、与真实对话一致的最小 chat 探测；端点/模型走统一 resolver）。 */
export async function validateKey(
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const config = await getStepfunConfig()
  try {
    const response = await fetcher(
      `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: config.chatModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (!response.ok) {
      // 仅服务端日志用于排障：不回显给客户端、不写入会被提交的文件、绝不含 Key
      console.error('[stepfun] validateKey 失败', {
        status: response.status,
        errorType: 'HttpError',
      })
      return false
    }
    await response.json()
    return true
  } catch (error) {
    const errorType = error instanceof Error ? error.name : 'UnknownError'
    console.error('[stepfun] validateKey 失败', {
      status: undefined,
      errorType,
    })
    return false
  }
}
