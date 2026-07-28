import 'server-only'
import { getStepfunConfig } from './config'
import { resolveManagedCredential } from './managed-credentials'
import { RouteContractError } from './route-contract-error'

/** 兼容旧调用名：只读取服务端托管凭据，绝不读取 workspace key。 */
export async function getStoredApiKey(): Promise<string | null> {
  return resolveManagedCredential('stepfun')
}

/** 托管凭据不可由 workspace 设置覆盖。 */
export async function saveApiKey(
  _apiKey: string,
  _verifiedAt = new Date(),
): Promise<void> {
  throw new RouteContractError('StepFun 托管凭据由服务端管理，不接受设置写入')
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
