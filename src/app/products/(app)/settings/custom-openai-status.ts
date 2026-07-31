import type { SettingsResponse } from './model-service-contract'

/** 自定义兼容家族的接入点数量：文本与视觉、TTS、ASR。 */
export const CUSTOM_ENDPOINT_COUNT = 3

/**
 * 已配置的自定义接入点数量。
 *
 * 供应商卡片与面板摘要都用它，避免两处各算一遍导致卡片说「已连接」而面板说
 * 「1 / 3 已配置」。
 */
export function countConfiguredCustomEndpoints(data: SettingsResponse): number {
  return [
    data.customOpenAi?.configured === true,
    data.customOpenAiTts?.configured === true,
    data.customOpenAiAsr?.configured === true,
  ].filter(Boolean).length
}
