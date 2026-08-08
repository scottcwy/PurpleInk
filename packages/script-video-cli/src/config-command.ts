import { createOpenAiCompatibleClient, type OpenAiCompatibleConfig } from './ai/openai-compatible'
import type { CliArgs } from './args'
import { LocalConfigStore, normalizeProviderBaseUrl } from './local-config'
import { SafeCliError } from './safe-error'
import type { SecretInput } from './secret-input'

export type TextProviderVerifier = (config: OpenAiCompatibleConfig) => Promise<void>

export interface ConfigCommandDependencies {
  store: LocalConfigStore
  secretInput: SecretInput
  stdinIsTty: boolean
  verifyTextProvider?: TextProviderVerifier
}

export async function executeConfigCommand(args: CliArgs, dependencies: ConfigCommandDependencies): Promise<unknown> {
  if (args.command !== 'config') throw new Error('config command required')
  if (args.configAction === 'show') return dependencies.store.summary()
  if (args.configAction === 'verify') {
    const config = await dependencies.store.loadTextProvider()
    await verifySafely(config, dependencies.verifyTextProvider)
    return { target: 'text', configured: true, verified: true }
  }
  if (args.configAction === 'set') {
    const baseUrl = normalizeProviderBaseUrl(requireText(args.configUrl, 'CONFIG_URL_REQUIRED'))
    const textModel = requireText(args.configModel, 'CONFIG_MODEL_REQUIRED')
    const apiKey = await readKey(args, dependencies)
    const config = { baseUrl, apiKey, textModel }
    await verifySafely(config, dependencies.verifyTextProvider)
    const maintenance = await dependencies.store.saveTextProfile({ baseUrl, model: textModel, apiKey })
    return { ...(await dependencies.store.summary()), maintenance }
  }
  throw new SafeCliError('CONFIG_ACTION_INVALID', 'config 子命令无效。', false, 400)
}

async function readKey(args: CliArgs, dependencies: ConfigCommandDependencies): Promise<string> {
  if (args.keyStdin) return dependencies.secretInput.readStdin()
  if (!dependencies.stdinIsTty) {
    throw new SafeCliError('KEY_INPUT_REQUIRED', '非交互环境必须使用 --key-stdin。', false, 400)
  }
  return dependencies.secretInput.readHidden()
}

async function verifySafely(config: OpenAiCompatibleConfig, verifier?: TextProviderVerifier): Promise<void> {
  try {
    await (verifier ?? verifyTextProvider)(config)
  } catch {
    throw new SafeCliError('CONFIG_VERIFICATION_FAILED', '文本模型连通性验证失败。', true, 422)
  }
}

async function verifyTextProvider(config: OpenAiCompatibleConfig): Promise<void> {
  const client = createOpenAiCompatibleClient({ ...config, maxRetries: 0 })
  const result = await client.completeJson({
    system: '只返回 JSON。',
    user: '返回 {"ok":true}，用于最小连通性验证。',
  })
  if (!isRecord(result) || result.ok !== true) throw new Error('invalid verification response')
}

function requireText(value: string | undefined, code: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new SafeCliError(code, 'config set text 缺少必要参数。', false, 400)
  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
