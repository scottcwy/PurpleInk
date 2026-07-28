import type { CanvasNodeType, NodeStatus } from '@/features/canvas/types'

/**
 * 可跳过节点类型全集映射（模式 C：Record 全集 + 全集遍历断言锁死）。
 *
 * 只有产出可被既有降级导出链占位的 shot 环节允许跳过：
 * - shot-codegen：黑场占位视频（placeholder-mp4）；
 * - shot-sfx：无音效缺省；
 * - shot-subtitle：字幕缺省为空。
 * 其余节点是下游输入的硬前置（脚本 / 分镜合同 / 配乐 / 质检 / 导出），
 * 跳过即无片可出，一律不可跳过。
 *
 * 本文件不带 server-only：UI 需要在客户端判断是否渲染「跳过此环节」按钮。
 */
export const SKIPPABLE: Record<CanvasNodeType, boolean> = {
  'script-import': false,
  'shot-split': false,
  score: false,
  export: false,
  'shot-script': false,
  'shot-codegen': true,
  'shot-sfx': true,
  'shot-subtitle': true,
  'shot-qa': false,
}

export function isSkippableNodeType(type: CanvasNodeType): boolean {
  return SKIPPABLE[type]
}

/** 仅这些状态允许人为跳过：running/pending 在跑、idle 未执行、success 无跳过理由。 */
export const SKIPPABLE_FROM_STATUSES = [
  'failed',
  'stale',
  'cancelled',
] as const satisfies readonly NodeStatus[]

export function isSkippableFromStatus(status: NodeStatus): boolean {
  return (SKIPPABLE_FROM_STATUSES as readonly NodeStatus[]).includes(status)
}

export const SKIP_REASON_MIN_LENGTH = 1
export const SKIP_REASON_MAX_LENGTH = 200
