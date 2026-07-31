import 'server-only'
import {
  type AiConfigDependencies,
  getAiConfigDependencies,
  resolveProviderApiKey,
  resolveProviderFunding,
} from './config'
import { resolveDeploymentBinding } from './execution-plan'

export type BuiltInAudioProviderId = 'stepfun' | 'mimo'

export interface BuiltInAudioConfig {
  apiKey: string | null
  baseUrl: string
  ttsModel: string
  asrModel: string
}

export async function resolveBuiltInAudioConfig(
  providerId: BuiltInAudioProviderId,
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<BuiltInAudioConfig> {
  const fundingSource = await resolveProviderFunding(providerId, deps)
  const [apiKey, tts, asr] = await Promise.all([
    resolveProviderApiKey(providerId, deps),
    Promise.resolve(resolveDeploymentBinding({
      providerId,
      fundingSource,
      capability: 'tts',
    })),
    Promise.resolve(resolveDeploymentBinding({
      providerId,
      fundingSource,
      capability: 'asr',
    })),
  ])
  if (tts.baseUrl !== asr.baseUrl) {
    throw new Error(`${providerId} audio deployments must share one channel`)
  }
  return {
    apiKey,
    baseUrl: tts.baseUrl,
    ttsModel: tts.outboundModelId,
    asrModel: asr.outboundModelId,
  }
}
