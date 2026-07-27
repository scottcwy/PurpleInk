import type { CanvasNodeType } from '@/features/canvas'
import type { AiTaskKind, MediaTaskKind } from '@/features/routing'
import type { ProviderCapability } from './provider-registry'

export type AiRouteTarget = { domain: 'ai'; kind: AiTaskKind }
export type RouteTarget = AiRouteTarget | { domain: 'media'; kind: MediaTaskKind }

/**
 * 节点的**主职责**路由：设置页的供应商选择、能力校验与展示都以它为准。
 *
 * 媒体泳道节点在这里声明媒体任务，因为设置页选的是「谁来做这一镜的 TTS / ASR」。
 * 它们的 Director 会话另有文本路由，见 `model-routing.ts` 的 `sessionTarget`。
 */
export const ROUTE_TARGET: Record<CanvasNodeType, RouteTarget> = {
  'script-import': { domain: 'ai', kind: 'project-plan' },
  'shot-split': { domain: 'ai', kind: 'project-plan' },
  score: { domain: 'ai', kind: 'project-plan' },
  export: { domain: 'ai', kind: 'project-plan' },
  'shot-script': { domain: 'ai', kind: 'shot-spec' },
  'shot-codegen': { domain: 'ai', kind: 'fabricate' },
  'shot-sfx': { domain: 'media', kind: 'tts' },
  'shot-subtitle': { domain: 'media', kind: 'asr' },
  'shot-qa': { domain: 'ai', kind: 'vision-qa' },
}

export function capabilityForTarget(target: RouteTarget): ProviderCapability {
  if (target.domain === 'media') return target.kind
  return target.kind === 'vision-qa' ? 'vision' : 'text'
}

export function targetKey(target: RouteTarget): string {
  return `${target.domain}:${target.kind}`
}
