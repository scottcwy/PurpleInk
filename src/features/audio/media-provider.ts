import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import {
  getAiConfigDependencies,
  type AiConfigDependencies,
} from '@/features/ai/config'
import type {
  OpenAiCompatibleAsrProfile,
  OpenAiCompatibleTtsProfile,
} from '@/features/ai/openai-compatible-payloads'
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
  type ManagedAudioInvocationRoute,
} from './managed-audio-billing'
import {
  audioProfiles,
  CUSTOM_ASR_PROVIDER,
  CUSTOM_TTS_PROVIDER,
  resolveMediaRouteTarget,
  type MediaRouteTarget,
  type MediaProviderId,
} from './media-route-target'
import {
  builtInAudioDependencies,
  requireCustomAsrProfile,
  requireCustomTtsProfile,
} from './media-invocation-route'

export { CUSTOM_ASR_PROVIDER, CUSTOM_TTS_PROVIDER }

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
    profile: OpenAiCompatibleTtsProfile,
    route: ManagedAudioInvocationRoute,
  ) => Promise<SynthesizedSpeech>
  transcribeCustom: (
    input: { audioBytes: Buffer; audioFormat: 'mp3' | 'wav' },
    profile: OpenAiCompatibleAsrProfile,
    route: ManagedAudioInvocationRoute,
    options?: { signal?: AbortSignal },
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
    synthesizeCustom: (input, profile, route) =>
      synthesizeOpenAiCompatibleSpeech(input, {
        fetcher: fetch,
        getProfile: async () => ({
          ...profile,
          baseUrl: route.resolvedPlan?.baseUrl ?? profile.baseUrl,
          model: route.resolvedPlan?.outboundModelId ?? profile.model,
        }),
        getApiKey: async () => route.credential,
      }),
    transcribeCustom: (input, profile, route, options) =>
      transcribeOpenAiCompatibleSpeech(input, {
        fetcher: fetch,
        getProfile: async () => ({
          ...profile,
          baseUrl: route.resolvedPlan?.baseUrl ?? profile.baseUrl,
          model: route.resolvedPlan?.outboundModelId ?? profile.model,
        }),
        getApiKey: async () => route.credential,
      }, options),
  }
}

export async function resolveNarrationEngine(
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<NarrationEngine> {
  const target = await resolveMediaRouteTarget('tts', deps)
  const engineTarget = { provider: target.provider, model: target.model }
  if (target.provider === CUSTOM_TTS_PROVIDER) {
    // 音色与容器格式由用户 profile 提供，不猜默认值。
    const profile = await audioProfiles(deps).findTts(currentWorkspaceId())
    if (!profile) throw new Error('自定义兼容 TTS 端点尚未配置')
    return {
      ...engineTarget,
      voice: profile.voice,
      audioFormat: profile.audioFormat,
    }
  }
  if (target.provider !== 'stepfun' && target.provider !== 'mimo') {
    throw new Error(`媒体路由供应商不支持 TTS：${target.provider}`)
  }
  return target.provider === 'mimo'
    ? { ...engineTarget, voice: 'mimo_default', audioFormat: 'wav' }
    : { ...engineTarget, voice: 'cixingnansheng', audioFormat: 'mp3' }
}

export async function synthesizeRoutedSpeech(
  input: {
    text: string
    voiceId?: string
    billingContext?: AudioBillingContext
  },
  dependencies: RoutedMediaDependencies = defaultDependencies(),
): Promise<SynthesizedSpeech> {
  const target = await resolveMediaRouteTarget('tts', dependencies.config)
  if (target.provider === CUSTOM_TTS_PROVIDER) {
    return (dependencies.billManaged ?? runManagedAudioBilling)({
      provider: target.provider,
      model: target.model,
      providerPoolId: target.providerPoolId,
      execution: executionMetadata(target),
      resolvedPlan: target.resolvedPlan,
      capability: 'tts',
      billingContext: input.billingContext,
      estimate: { kind: 'tts', characters: Array.from(input.text).length },
      input: input.text,
      invoke: (route) => dependencies.synthesizeCustom(
        { text: input.text, voiceId: input.voiceId },
        requireCustomTtsProfile(target),
        route,
      ),
      outputBytes: (speech) => speech.audioBytes,
      usageFromResult: (speech) => ({
        kind: 'tts',
        inputCharacters: Array.from(input.text).length,
        outputAudioSeconds: Math.max(0, speech.durationMs / 1_000),
      }),
    })
  }
  if (target.provider !== 'stepfun' && target.provider !== 'mimo') {
    throw new Error(`媒体路由供应商不支持 TTS：${target.provider}`)
  }
  const managedProvider = target.provider
  const invoke = (route: ManagedAudioInvocationRoute) => managedProvider === 'mimo'
    ? dependencies.synthesizeMimo(
        { text: input.text, voiceId: input.voiceId },
        builtInAudioDependencies(target, route),
      )
    : dependencies.synthesizeStepfun(
        { text: input.text, voiceId: input.voiceId },
        builtInAudioDependencies(target, route),
      )
  return (dependencies.billManaged ?? runManagedAudioBilling)({
    provider: managedProvider,
    model: target.model,
    providerPoolId: target.providerPoolId,
    execution: executionMetadata(target),
    resolvedPlan: target.resolvedPlan,
    capability: 'tts',
    billingContext: input.billingContext,
    estimate: { kind: 'tts', characters: Array.from(input.text).length },
    input: input.text,
    invoke,
    outputBytes: (speech) => speech.audioBytes,
    usageFromResult: (speech) => ({
      kind: 'tts',
      inputCharacters: Array.from(input.text).length,
      outputAudioSeconds: Math.max(0, speech.durationMs / 1_000),
    }),
  })
}

export async function transcribeRoutedSpeech(
  input: {
    audioBytes: Buffer
    audioFormat: 'mp3' | 'wav' | 'ogg' | 'pcm'
    audioSeconds?: number
    billingContext?: AudioBillingContext
    signal?: AbortSignal
  },
  dependencies: RoutedMediaDependencies = defaultDependencies(),
): Promise<RoutedTranscribedSpeech> {
  const target = await resolveMediaRouteTarget('asr', dependencies.config)
  if (target.provider === CUSTOM_ASR_PROVIDER) {
    const audioSeconds = input.audioSeconds ?? 0
    const result = await (dependencies.billManaged ?? runManagedAudioBilling)({
      provider: target.provider,
      model: target.model,
      providerPoolId: target.providerPoolId,
      execution: executionMetadata(target),
      resolvedPlan: target.resolvedPlan,
      capability: 'asr',
      billingContext: input.billingContext,
      estimate: { kind: 'asr', audioSeconds },
      input: input.audioBytes,
      invoke: (route) => dependencies.transcribeCustom(
        {
          audioBytes: input.audioBytes,
          audioFormat: compactFormat(input, '自定义兼容 ASR'),
        },
        requireCustomAsrProfile(target),
        route,
        { signal: input.signal },
      ),
      outputBytes: (speech) => speech.transcript,
      usageFromResult: () => audioSeconds > 0
        ? { kind: 'asr', inputAudioSeconds: audioSeconds }
        : null,
    })
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
  const invoke = async (route: ManagedAudioInvocationRoute) => {
    const audioDependencies = builtInAudioDependencies(target, route)
    if (managedProvider === 'mimo') {
      const result = await dependencies.transcribeMimo(
        {
          audioBytes: input.audioBytes,
          audioFormat: compactFormat(input, 'MiMo ASR'),
        },
        audioDependencies,
        { signal: input.signal },
      )
      return { ...result, alignmentSource: 'mimo-asr-segment' as const }
    }
    const result = await dependencies.transcribeStepfun(
      {
        audioBytes: input.audioBytes,
        audioFormat: input.audioFormat,
      },
      audioDependencies,
      { signal: input.signal },
    )
    return { ...result, alignmentSource: 'stepfun-asr' as const }
  }
  return (dependencies.billManaged ?? runManagedAudioBilling)({
    provider: managedProvider,
    model: target.model,
    providerPoolId: target.providerPoolId,
    execution: executionMetadata(target),
    resolvedPlan: target.resolvedPlan,
    capability: 'asr',
    billingContext: input.billingContext,
    estimate: { kind: 'asr', audioSeconds: audioSeconds! },
    input: input.audioBytes,
    invoke,
    outputBytes: (speech) => speech.transcript,
    usageFromResult: () => ({
      kind: 'asr',
      inputAudioSeconds: audioSeconds!,
    }),
  })
}

function executionMetadata(target: MediaRouteTarget) {
  return {
    logicalModelId: target.logicalModelId,
    outboundModelId: target.model,
    deploymentId: target.deploymentId,
    channelId: target.channelId,
    adapterProtocol: target.adapterProtocol,
    officialPriceIdentity: target.officialPriceIdentity,
    providerPoolId: target.providerPoolId,
    failureDomainId: target.failureDomainId,
  }
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
  const target = await resolveMediaRouteTarget(kind, deps)
  return { provider: target.provider, model: target.model }
}

export type { MediaProviderId, SynthesizedSpeech, TranscribedSpeech }
