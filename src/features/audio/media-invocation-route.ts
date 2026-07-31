import type { BuiltInAudioConfig } from '@/features/ai/built-in-audio-config'
import type {
  OpenAiCompatibleAsrProfile,
  OpenAiCompatibleTtsProfile,
} from '@/features/ai/openai-compatible-payloads'
import type { ManagedAudioInvocationRoute } from './managed-audio-billing'
import type { MediaRouteTarget } from './media-route-target'

export function builtInAudioDependencies(
  target: MediaRouteTarget,
  route: ManagedAudioInvocationRoute,
) {
  const config: BuiltInAudioConfig = {
    apiKey: route.credential,
    baseUrl: route.resolvedPlan?.baseUrl ?? target.resolvedPlan.baseUrl,
    ttsModel: target.resolvedPlan.capability === 'tts'
      ? target.resolvedPlan.outboundModelId
      : target.model,
    asrModel: target.resolvedPlan.capability === 'asr'
      ? target.resolvedPlan.outboundModelId
      : target.model,
  }
  return { fetcher: fetch, getConfig: async () => config }
}

export function requireCustomTtsProfile(
  target: MediaRouteTarget,
): OpenAiCompatibleTtsProfile {
  const profile = target.customAudioProfile
  if (!profile || !('voice' in profile)) {
    throw new Error('自定义兼容 TTS 执行计划缺少音色与容器快照')
  }
  return profile
}

export function requireCustomAsrProfile(
  target: MediaRouteTarget,
): OpenAiCompatibleAsrProfile {
  const profile = target.customAudioProfile
  if (!profile || !('timestampMode' in profile)) {
    throw new Error('自定义兼容 ASR 执行计划缺少时间戳能力快照')
  }
  return profile
}
