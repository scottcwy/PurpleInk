import 'server-only'
import OpenAI from 'openai'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import {
  getAiConfigDependencies,
  getStepfunConfig,
  resolveStepfunBaseUrl,
} from './config'
import type { ChatMessage, ChatOptions, LlmAdapter } from './types'

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

function createClient(apiKey: string, baseUrl: string): OpenAI {
  return new OpenAI({ apiKey, baseURL: baseUrl })
}

/** 校验 Key 是否可用（用与真实对话一致的最小 chat 探测；端点/模型走统一 resolver）。 */
export async function validateKey(apiKey: string): Promise<boolean> {
  const config = await getStepfunConfig()
  try {
    await createClient(apiKey, config.baseUrl).chat.completions.create(
      {
        model: config.chatModel,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      },
      { timeout: 15_000, maxRetries: 0 },
    )
    return true
  } catch (error) {
    // 仅服务端日志用于排障：不回显给客户端、不写入会被提交的文件、绝不含 Key
    const status = error instanceof OpenAI.APIError ? error.status : undefined
    const errorType = error instanceof Error ? error.name : 'UnknownError'
    console.error('[stepfun] validateKey 失败', { status, errorType })
    return false
  }
}

/** 用本地保存的 Key 构造适配器；未配置返回 null。 */
export async function createLlmFromSettings(): Promise<StepfunAdapter | null> {
  const key = await getStoredApiKey()
  return key ? new StepfunAdapter(key) : null
}

/** StepFun LLM 适配器（OpenAI 兼容端点；端点/模型统一走 `getStepfunConfig()`）。 */
export class StepfunAdapter implements LlmAdapter {
  private readonly client: OpenAI

  constructor(apiKey: string) {
    this.client = createClient(apiKey, resolveStepfunBaseUrl())
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const model = options.model ?? (await getStepfunConfig()).chatModel
    const res = await this.client.chat.completions.create({
      model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    })
    return res.choices[0]?.message?.content ?? ''
  }
}
