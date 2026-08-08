import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createOpenAiCompatibleClient, type OpenAiCompatibleConfig } from './ai/openai-compatible'
import type { CliArgs } from './args'
import { LocalConfigStore, normalizeProviderBaseUrl } from './local-config'
import { SafeCliError } from './safe-error'
import type { SecretInput } from './secret-input'
import {
  createMimoSpeechClient,
  MIMO_ASR_MODEL,
  MIMO_TTS_MODEL,
  MIMO_VOICE_CLONE_MODEL,
  type MimoSpeechClient,
  type MimoSpeechConfig,
} from './speech/mimo-client'

export type TextProviderVerifier = (config: OpenAiCompatibleConfig) => Promise<void>
export type SpeechProviderVerifier = (config: MimoSpeechConfig) => Promise<void>

export interface ConfigCommandDependencies {
  store: LocalConfigStore
  secretInput: SecretInput
  stdinIsTty: boolean
  verifyTextProvider?: TextProviderVerifier
  verifySpeechProvider?: SpeechProviderVerifier
}

export async function executeConfigCommand(args: CliArgs, dependencies: ConfigCommandDependencies): Promise<unknown> {
  if (args.command !== 'config') throw new Error('config command required')
  if (args.configAction === 'show') return dependencies.store.summary()
  if (args.configAction === 'verify') return verifyStoredProfiles(args, dependencies)
  if (args.configAction === 'set' && args.configTarget === 'text') return setTextProfile(args, dependencies)
  if (args.configAction === 'set' && args.configTarget === 'speech') return setSpeechProfile(args, dependencies)
  throw new SafeCliError('CONFIG_ACTION_INVALID', 'config 子命令无效。', false, 400)
}

export async function verifySpeechRoundTrip(
  config: MimoSpeechConfig,
  options: { client?: MimoSpeechClient; temporaryRoot?: string } = {},
): Promise<void> {
  const client = options.client ?? createMimoSpeechClient({ ...config, maxRetries: 0 })
  const directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), 'purpleink-speech-verify-'))
  const wavPath = join(directory, 'probe.wav')
  try {
    const tts = await client.synthesize({
      text: '紫墨语音连通性验证。',
      style: '自然、清晰、语速适中。',
      voice: 'mimo_default',
    })
    await writeFile(wavPath, tts.audio)
    const wav = await readFile(wavPath)
    const asr = await client.transcribe({ audio: wav, mimeType: 'audio/wav', language: 'zh' })
    if (!asr.text.trim()) throw new Error('empty ASR verification result')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function setTextProfile(args: CliArgs, dependencies: ConfigCommandDependencies): Promise<unknown> {
  const baseUrl = normalizeProviderBaseUrl(requireText(args.configUrl, 'CONFIG_URL_REQUIRED', '文本模型 URL'))
  const textModel = requireText(args.configModel, 'CONFIG_MODEL_REQUIRED', '文本模型 ID')
  const apiKey = await readKey(args, dependencies)
  const config = { baseUrl, apiKey, textModel }
  await verifyTextSafely(config, dependencies.verifyTextProvider)
  const maintenance = await dependencies.store.saveTextProfile({ baseUrl, model: textModel, apiKey })
  return { ...(await dependencies.store.summary()), maintenance }
}

async function setSpeechProfile(args: CliArgs, dependencies: ConfigCommandDependencies): Promise<unknown> {
  const baseUrl = normalizeProviderBaseUrl(requireText(args.configUrl, 'CONFIG_URL_REQUIRED', '语音模型 URL'))
  const ttsModel = requireExactModel(args.configTtsModel, MIMO_TTS_MODEL, 'TTS')
  const asrModel = requireExactModel(args.configAsrModel, MIMO_ASR_MODEL, 'ASR')
  const apiKey = await readKey(args, dependencies)
  const config: MimoSpeechConfig = {
    baseUrl,
    apiKey,
    ttsModel,
    voiceCloneModel: MIMO_VOICE_CLONE_MODEL,
    asrModel,
  }
  await verifySpeechSafely(config, dependencies.verifySpeechProvider)
  const maintenance = await dependencies.store.saveSpeechProfile({ baseUrl, ttsModel, asrModel, apiKey })
  return { ...(await dependencies.store.summary()), maintenance }
}

async function verifyStoredProfiles(args: CliArgs, dependencies: ConfigCommandDependencies): Promise<unknown> {
  if (args.configTarget === 'text') {
    await verifyTextSafely(await dependencies.store.loadTextProvider(), dependencies.verifyTextProvider)
    return { target: 'text', configured: true, verified: true }
  }
  if (args.configTarget === 'speech') {
    await verifySpeechSafely(await dependencies.store.loadSpeechProvider(), dependencies.verifySpeechProvider)
    return { target: 'speech', configured: true, tts: true, asr: true }
  }
  if (args.configTarget === 'all') {
    await verifyTextSafely(await dependencies.store.loadTextProvider(), dependencies.verifyTextProvider)
    await verifySpeechSafely(await dependencies.store.loadSpeechProvider(), dependencies.verifySpeechProvider)
    return { target: 'all', text: { verified: true }, speech: { tts: true, asr: true } }
  }
  throw new SafeCliError('CONFIG_TARGET_INVALID', 'config verify 目标无效。', false, 400)
}

async function readKey(args: CliArgs, dependencies: ConfigCommandDependencies): Promise<string> {
  if (args.keyStdin) return dependencies.secretInput.readStdin()
  if (!dependencies.stdinIsTty) {
    throw new SafeCliError('KEY_INPUT_REQUIRED', '非交互环境必须使用 --key-stdin。', false, 400)
  }
  return dependencies.secretInput.readHidden()
}

async function verifyTextSafely(config: OpenAiCompatibleConfig, verifier?: TextProviderVerifier): Promise<void> {
  try {
    await (verifier ?? verifyTextProvider)(config)
  } catch {
    throw new SafeCliError('CONFIG_VERIFICATION_FAILED', '文本模型连通性验证失败。', true, 422)
  }
}

async function verifySpeechSafely(config: MimoSpeechConfig, verifier?: SpeechProviderVerifier): Promise<void> {
  try {
    await (verifier ?? verifySpeechRoundTrip)(config)
  } catch {
    throw new SafeCliError('CONFIG_VERIFICATION_FAILED', '语音模型连通性验证失败。', true, 422)
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

function requireText(value: string | undefined, code: string, label: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new SafeCliError(code, `${label}不能为空。`, false, 400)
  return normalized
}

function requireExactModel(value: string | undefined, expected: string, label: string): string {
  const model = requireText(value, 'CONFIG_MODEL_REQUIRED', `${label} Model ID`)
  if (model !== expected) {
    throw new SafeCliError('CONFIG_MODEL_INVALID', `${label} Model ID 不受支持。`, false, 400)
  }
  return model
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
