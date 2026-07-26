import 'server-only'
import {
  getAiConfigDependencies,
  getStepfunConfig,
  type AiConfigDependencies,
} from '@/features/ai/config'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import {
  synthesizeMimoSpeech,
  transcribeMimoSpeech,
} from './mimo-audio-client'
import {
  synthesizeSpeech,
  transcribeSpeech,
  type SynthesizedSpeech,
  type TranscribedSpeech,
} from './stepfun-audio-client'

type MediaProviderId = 'stepfun' | 'mimo'

export interface NarrationEngine {
  provider: MediaProviderId
  model: string
  voice: string
  audioFormat: 'mp3' | 'wav'
}

export type SubtitleAlignmentSource = 'stepfun-asr' | 'mimo-asr-segment'
export type RoutedTranscribedSpeech = TranscribedSpeech & {
  alignmentSource: SubtitleAlignmentSource
}

interface RoutedMediaDependencies {
  config: AiConfigDependencies
  synthesizeStepfun: typeof synthesizeSpeech
  synthesizeMimo: typeof synthesizeMimoSpeech
  transcribeStepfun: typeof transcribeSpeech
  transcribeMimo: typeof transcribeMimoSpeech
}

function defaultDependencies(): RoutedMediaDependencies {
  return {
    config: getAiConfigDependencies(),
    synthesizeStepfun: synthesizeSpeech,
    synthesizeMimo: synthesizeMimoSpeech,
    transcribeStepfun: transcribeSpeech,
    transcribeMimo: transcribeMimoSpeech,
  }
}

async function resolveProvider(
  kind: 'tts' | 'asr',
  deps: AiConfigDependencies
): Promise<{ provider: MediaProviderId; model: string }> {
  const route = await deps.mediaRoutes.resolve(LOCAL_WORKSPACE_ID, kind)
  if (!route) {
    const config = await getStepfunConfig(deps)
    return {
      provider: 'stepfun',
      model: kind === 'tts' ? config.ttsModel : config.asrModel,
    }
  }
  if (route.provider !== 'stepfun' && route.provider !== 'mimo') {
    throw new Error(`媒体路由供应商不受支持：${route.provider}`)
  }
  return { provider: route.provider, model: route.model }
}

export async function resolveNarrationEngine(
  deps: AiConfigDependencies = getAiConfigDependencies()
): Promise<NarrationEngine> {
  const target = await resolveProvider('tts', deps)
  return target.provider === 'mimo'
    ? {
        ...target,
        voice: 'mimo_default',
        audioFormat: 'wav',
      }
    : {
        ...target,
        voice: 'cixingnansheng',
        audioFormat: 'mp3',
      }
}

export async function synthesizeRoutedSpeech(
  input: { text: string; voiceId?: string },
  dependencies: RoutedMediaDependencies = defaultDependencies()
): Promise<SynthesizedSpeech> {
  const target = await resolveProvider('tts', dependencies.config)
  return target.provider === 'mimo'
    ? dependencies.synthesizeMimo(input)
    : dependencies.synthesizeStepfun(input)
}

export async function transcribeRoutedSpeech(
  input: {
    audioBytes: Buffer
    audioFormat: 'mp3' | 'wav' | 'ogg' | 'pcm'
  },
  dependencies: RoutedMediaDependencies = defaultDependencies()
): Promise<RoutedTranscribedSpeech> {
  const target = await resolveProvider('asr', dependencies.config)
  if (target.provider === 'mimo') {
    if (input.audioFormat !== 'mp3' && input.audioFormat !== 'wav') {
      throw new Error('MiMo ASR 仅支持 MP3 或 WAV 音频')
    }
    const result = await dependencies.transcribeMimo({
      audioBytes: input.audioBytes,
      audioFormat: input.audioFormat,
    })
    return { ...result, alignmentSource: 'mimo-asr-segment' }
  }
  const result = await dependencies.transcribeStepfun(input)
  return { ...result, alignmentSource: 'stepfun-asr' }
}

export async function describeMediaProvider(
  kind: 'tts' | 'asr',
  deps: AiConfigDependencies = getAiConfigDependencies()
): Promise<{ provider: MediaProviderId; model: string }> {
  return resolveProvider(kind, deps)
}

export type { SynthesizedSpeech, TranscribedSpeech }
