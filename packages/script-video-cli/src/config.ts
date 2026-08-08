import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { createOpenAiCompatibleClient, type AiClient, type OpenAiCompatibleConfig } from './ai/openai-compatible'
import { createFixtureAiClient } from './ai/fixture'
import type { LocalConfigStore } from './local-config'

export const WORKFLOW_VERSION = 'script-video-cli-v1' as const
export type CliProvider = 'openai-compatible' | 'fixture'

export interface CliConfig {
  provider: CliProvider
  stateDir: string
  concurrency: number
  browserGate: boolean
  ai: OpenAiCompatibleConfig
}

export interface ConfigSummary {
  provider: CliProvider
  stateDir: string
  concurrency: number
  browserGate: boolean
  aiConfigured: boolean
  baseUrlConfigured: boolean
  textModel: string | null
  visionModel: string | null
}

export function loadLocalEnvFile(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): void {
  if (env !== process.env) return
  const baseDir = env.INIT_CWD?.trim() || cwd
  const envPath = resolve(baseDir, '.env.local')
  if (!existsSync(envPath)) return
  try {
    process.loadEnvFile(envPath)
  } catch {
    const error = new Error('ENV_FILE_INVALID') as Error & { code?: string }
    error.code = 'ENV_FILE_INVALID'
    throw error
  }
}

export function readCliConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): CliConfig {
  const provider = readProvider(env.SCRIPT_VIDEO_PROVIDER)
  const baseDir = env.INIT_CWD?.trim() || cwd
  const stateDir = resolve(baseDir, env.SCRIPT_VIDEO_STATE_DIR?.trim() || '.purpleink/runs')
  const concurrency = boundedInteger(env.SCRIPT_VIDEO_CONCURRENCY, 4, 1, 32)
  return {
    provider,
    stateDir,
    concurrency,
    browserGate: env.SCRIPT_VIDEO_BROWSER_GATE !== 'false',
    ai: {
      baseUrl: env.SCRIPT_VIDEO_AI_BASE_URL?.trim() ?? '',
      apiKey: env.SCRIPT_VIDEO_AI_API_KEY?.trim() ?? '',
      textModel: env.SCRIPT_VIDEO_AI_MODEL?.trim() ?? '',
      visionModel: env.SCRIPT_VIDEO_AI_VISION_MODEL?.trim() || undefined,
      requestTimeoutMs: boundedInteger(env.SCRIPT_VIDEO_AI_TIMEOUT_MS, 120_000, 100, 600_000),
      maxRetries: boundedInteger(env.SCRIPT_VIDEO_AI_MAX_RETRIES, 2, 0, 5),
      retryBaseDelayMs: boundedInteger(env.SCRIPT_VIDEO_AI_RETRY_DELAY_MS, 250, 0, 10_000),
    },
  }
}

export async function readEffectiveCliConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  localStore?: LocalConfigStore,
  options: { provider?: CliProvider; loadTextSecret?: boolean } = {},
): Promise<CliConfig> {
  const configured = readCliConfig(env, cwd)
  const base = options.provider ? { ...configured, provider: options.provider } : configured
  if (!localStore) return base
  const local = await localStore.read()
  const concurrency = env.SCRIPT_VIDEO_CONCURRENCY?.trim()
    ? base.concurrency
    : (local?.concurrency.text ?? base.concurrency)
  if (options.loadTextSecret === false || base.provider === 'fixture' || hasEnvironmentTextProfile(env)) {
    return { ...base, concurrency }
  }
  if (!local?.text) return { ...base, concurrency }
  const localAi = await localStore.loadTextProvider()
  return {
    ...base,
    concurrency,
    ai: {
      ...base.ai,
      ...localAi,
      visionModel: base.ai.visionModel,
    },
  }
}

export function createConfiguredAiClient(config: CliConfig): AiClient {
  return config.provider === 'fixture' ? createFixtureAiClient() : createOpenAiCompatibleClient(config.ai)
}

export function getConfigSummary(config: CliConfig): ConfigSummary {
  const baseUrlConfigured = config.ai.baseUrl.length > 0
  const textModelConfigured = config.ai.textModel.length > 0
  return {
    provider: config.provider,
    stateDir: config.stateDir,
    concurrency: config.concurrency,
    browserGate: config.browserGate,
    aiConfigured:
      config.provider === 'fixture' || (baseUrlConfigured && config.ai.apiKey.length > 0 && textModelConfigured),
    baseUrlConfigured,
    textModel: textModelConfigured ? config.ai.textModel : null,
    visionModel: config.ai.visionModel ?? null,
  }
}

function readProvider(value: string | undefined): CliProvider {
  if (value === undefined || value === '' || value === 'openai-compatible') return 'openai-compatible'
  if (value === 'fixture') return 'fixture'
  throw new Error('SCRIPT_VIDEO_PROVIDER 只支持 openai-compatible 或 fixture')
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error('环境变量中的整数配置无效')
  return Math.min(max, Math.max(min, parsed))
}

function hasEnvironmentTextProfile(env: NodeJS.ProcessEnv): boolean {
  return [env.SCRIPT_VIDEO_AI_BASE_URL, env.SCRIPT_VIDEO_AI_API_KEY, env.SCRIPT_VIDEO_AI_MODEL].some((value) =>
    Boolean(value?.trim()),
  )
}
