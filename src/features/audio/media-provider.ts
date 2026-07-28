import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import {
  getAiConfigDependencies,
  getStepfunConfig,
  type AiConfigDependencies,
} from '@/features/ai/config'
import { requireManagedCredential } from '@/features/ai'
import {
  synthesizeMimoSpeech,
  transcribeMimoSpeech,
} from './mimo-audio-client'
import {
  synthesizeOpenAiCompatibleSpeech,
  transcribeOpenAiCompatibleSpeech,
} from './openai-compatible-audio-client'
import {
  synthesizeSpeech,
  transcribeSpeech,
  type SynthesizedSpeech,
  type TranscribedSpeech,
} from './stepfun-audio-client'
import {
  runManagedAudioBilling,
  type AudioBillingContext,
  type ManagedAudioBillingInput,
} from './managed-audio-billing'

export const CUSTOM_TTS_PROVIDER = 'openai-compatible-tts' as const
export const CUSTOM_ASR_PROVIDER = 'openai-compatible-asr' as const

type MediaProviderId =
  | 'stepfun'
  | 'mimo'
  | typeof CUSTOM_TTS_PROVIDER
  | typeof CUSTOM_ASR_PROVIDER

export interface NarrationEngine {
  provider: MediaProviderId
  model: string
  voice: string
  audioFormat: 'mp3' | 'wav'
}

/**
 * 字幕对齐方式的真值。
 *
 * `-whole` 表示该 ASR 端点不返回分段时间戳，字幕按实测音频总长整段对齐；这必须是
 * 一个独立取值而不是复用 `-segment`，否则 UI 会声称有逐段对齐而实际没有。
 */
export type SubtitleAlignmentSource =
  | 'stepfun-asr'
  | 'mimo-asr-segment'
  | 'openai-compatible-asr-segment'
  | 'openai-compatible-asr-whole'

export type RoutedTranscribedSpeech = TranscribedSpeech & {
  alignmentSource: SubtitleAlignmentSource
}

/** 需要按实测音频总长兜一条整段字幕的对齐方式。 */
export function needsWholeClipAlignment(
  source: SubtitleAlignmentSource,
): boolean {
  return source === 'mimo-asr-segment'
    || source === 'openai-compatible-asr-whole'
}

interface RoutedMediaDependencies {
  config: AiConfigDependencies
  synthesizeStepfun: typeof synthesizeSpeech
  synthesizeMimo: typeof synthesizeMimoSpeech
  transcribeStepfun: typeof transcribeSpeech
  transcribeMimo: typeof transcribeMimoSpeech
  synthesizeCustom: (
    input: { text: string; voiceId?: string },
    deps: AiConfigDependencies,
  ) => Promise<SynthesizedSpeech>
  transcribeCustom: (
    input: { audioBytes: Buffer; audioFormat: 'mp3' | 'wav' },
    deps: AiConfigDependencies,
  ) => Promise<TranscribedSpeech & { timestampMode: 'segment' | 'none' }>
  billManaged?: <T>(input: ManagedAudioBillingInput<T>) => Promise<T>
}

function defaultDependencies(): RoutedMediaDependencies {
  return {
    config: getAiConfigDependencies(),
    synthesizeStepfun: synthesizeSpeech,
    synthesizeMimo: synthesizeMimoSpeech,
    transcribeStepfun: transcribeSpeech,
    transcribeMimo: transcribeMimoSpeech,
    synthesizeCustom: (input, deps) =>
      synthesizeOpenAiCompatibleSpeech(input, {
        fetcher: fetch,
        getProfile: () => audioProfiles(deps).findTts(currentWorkspaceId()),
        getApiKey: () =>
          deps.credentials.loadSecret(currentWorkspaceId(), CUSTOM_TTS_PROVIDER),
      }),
    transcribeCustom: (input, deps) =>
      transcribeOpenAiCompatibleSpeech(input, {
        fetcher: fetch,
        getProfile: () => audioProfiles(deps).findAsr(currentWorkspaceId()),
        getApiKey: () =>
          deps.credentials.loadSecret(currentWorkspaceId(), CUSTOM_ASR_PROVIDER),
      }),
  }
}

function audioProfiles(deps: AiConfigDependencies) {
  const store = deps.openAiCompatibleAudioProfiles
  if (!store) throw new Error('自定义兼容音频端点配置存储不可用')
  return store
}

const MEDIA_PROVIDERS: readonly MediaProviderId[] = [
  'stepfun',
  'mimo',
  CUSTOM_TTS_PROVIDER,
  CUSTOM_ASR_PROVIDER,
]

/**
 * 解析该媒体任务的供应商与模型。
 *
 * 自定义端点的模型以 profile 为准而不是 `route.model`：模型是 profile 的字段，
 * 保存 profile 时会同步 re-sync 路由行，这里再读一次 profile 保证 `NarrationEngine`
 * 与 client 实际下发的 model 一致——否则 `narration.ts` 的 `assertEngine`
 * 会以「TTS 模型与配置不一致」失败。
 */
async function resolveProvider(
  kind: 'tts' | 'asr',
  deps: AiConfigDependencies,
): Promise<{ provider: MediaProviderId; model: string }> {
  const route = await deps.mediaRoutes.resolve(currentWorkspaceId(), kind)
  if (!route) {
    const config = await getStepfunConfig(deps)
    return {
      provider: 'stepfun',
      model: kind === 'tts' ? config.ttsModel : config.asrModel,
    }
  }
  const provider = MEDIA_PROVIDERS.find((candidate) => candidate === route.provider)
  if (!provider) {
    throw new Error(`媒体路由供应商不受支持：${route.provider}`)
  }
  if (provider === CUSTOM_TTS_PROVIDER || provider === CUSTOM_ASR_PROVIDER) {
    return { provider, model: await customModel(provider, deps) }
  }
  return { provider, model: route.model }
}

async function customModel(
  provider: typeof CUSTOM_TTS_PROVIDER | typeof CUSTOM_ASR_PROVIDER,
  deps: AiConfigDependencies,
): Promise<string> {
  const store = audioProfiles(deps)
  const profile = provider === CUSTOM_TTS_PROVIDER
    ? await store.findTts(currentWorkspaceId())
    : await store.findAsr(currentWorkspaceId())
  if (!profile) {
    throw new Error(
      provider === CUSTOM_TTS_PROVIDER
        ? '自定义兼容 TTS 端点尚未配置'
        : '自定义兼容 ASR 端点尚未配置',
    )
  }
  return profile.model
}

export async function resolveNarrationEngine(
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<NarrationEngine> {
  const target = await resolveProvider('tts', deps)
  if (target.provider === CUSTOM_TTS_PROVIDER) {
    // 音色与容器格式由用户 profile 提供，不猜默认值。
    const profile = await audioProfiles(deps).findTts(currentWorkspaceId())
    if (!profile) throw new Error('自定义兼容 TTS 端点尚未配置')
    return {
      ...target,
      voice: profile.voice,
      audioFormat: profile.audioFormat,
    }
  }
  if (target.provider !== 'stepfun' && target.provider !== 'mimo') {
    throw new Error(`媒体路由供应商不支持 TTS：${target.provider}`)
  }
  return target.provider === 'mimo'
    ? { ...target, voice: 'mimo_default', audioFormat: 'wav' }
    : { ...target, voice: 'cixingnansheng', audioFormat: 'mp3' }
}

export async function synthesizeRoutedSpeech(
  input: {
    text: string
    voiceId?: string
    billingContext?: AudioBillingContext
  },
  dependencies: RoutedMediaDependencies = defaultDependencies(),
): Promise<SynthesizedSpeech> {
  const target = await resolveProvider('tts', dependencies.config)
  if (target.provider === CUSTOM_TTS_PROVIDER) {
    return dependencies.synthesizeCustom(
      { text: input.text, voiceId: input.voiceId },
      dependencies.config,
    )
  }
  if (target.provider !== 'stepfun' && target.provider !== 'mimo') {
    throw new Error(`媒体路由供应商不支持 TTS：${target.provider}`)
  }
  const managedProvider = target.provider
  const invoke = () => managedProvider === 'mimo'
    ? dependencies.synthesizeMimo({ text: input.text, voiceId: input.voiceId })
    : dependencies.synthesizeStepfun({ text: input.text, voiceId: input.voiceId })
  return (dependencies.billManaged ?? runManagedAudioBilling)({
    provider: managedProvider,
    model: target.model,
    capability: 'tts',
    billingContext: input.billingContext,
    estimate: { kind: 'tts', characters: input.text.length },
    input: input.text,
    prepare: async () => {
      requireManagedCredential(managedProvider)
    },
    invoke,
    outputBytes: (speech) => speech.audioBytes,
  })
}

export async function transcribeRoutedSpeech(
  input: {
    audioBytes: Buffer
    audioFormat: 'mp3' | 'wav' | 'ogg' | 'pcm'
    audioSeconds?: number
    billingContext?: AudioBillingContext
  },
  dependencies: RoutedMediaDependencies = defaultDependencies(),
): Promise<RoutedTranscribedSpeech> {
  const target = await resolveProvider('asr', dependencies.config)
  if (target.provider === CUSTOM_ASR_PROVIDER) {
    const result = await dependencies.transcribeCustom(
      { audioBytes: input.audioBytes, audioFormat: compactFormat(input, '自定义兼容 ASR') },
      dependencies.config,
    )
    return {
      ...result,
      alignmentSource: result.timestampMode === 'segment'
        ? 'openai-compatible-asr-segment'
        : 'openai-compatible-asr-whole',
    }
  }
  if (target.provider !== 'stepfun' && target.provider !== 'mimo') {
    throw new Error(`媒体路由供应商不支持 ASR：${target.provider}`)
  }
  const managedProvider = target.provider
  const audioSeconds = input.audioSeconds
  if (!Number.isFinite(audioSeconds) || (audioSeconds ?? 0) <= 0) {
    throw new Error('托管 ASR 调用缺少实测音频时长')
  }
  const invoke = async () => {
    if (managedProvider === 'mimo') {
      const result = await dependencies.transcribeMimo({
        audioBytes: input.audioBytes,
        audioFormat: compactFormat(input, 'MiMo ASR'),
      })
      return { ...result, alignmentSource: 'mimo-asr-segment' as const }
    }
    const result = await dependencies.transcribeStepfun({
      audioBytes: input.audioBytes,
      audioFormat: input.audioFormat,
    })
    return { ...result, alignmentSource: 'stepfun-asr' as const }
  }
  return (dependencies.billManaged ?? runManagedAudioBilling)({
    provider: managedProvider,
    model: target.model,
    capability: 'asr',
    billingContext: input.billingContext,
    estimate: { kind: 'asr', audioSeconds: audioSeconds! },
    input: input.audioBytes,
    prepare: async () => {
      requireManagedCredential(managedProvider)
    },
    invoke,
    outputBytes: (speech) => speech.transcript,
  })
}

/** 只接受 MP3 / WAV 的供应商共用的收窄：格式不符必须显式失败，不静默转码。 */
function compactFormat(
  input: { audioFormat: 'mp3' | 'wav' | 'ogg' | 'pcm' },
  operation: string,
): 'mp3' | 'wav' {
  if (input.audioFormat !== 'mp3' && input.audioFormat !== 'wav') {
    throw new Error(`${operation} 仅支持 MP3 或 WAV 音频`)
  }
  return input.audioFormat
}

export async function describeMediaProvider(
  kind: 'tts' | 'asr',
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<{ provider: MediaProviderId; model: string }> {
  return resolveProvider(kind, deps)
}

export type { MediaProviderId, SynthesizedSpeech, TranscribedSpeech }
