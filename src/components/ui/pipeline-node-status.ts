import { CircleSlash, TriangleAlert } from 'lucide-react'
import type { ComponentType } from 'react'
import type { StatusPillVariant } from '@/components/ui/status-pill'
import type { CanvasNodeType, NodeStatus } from '@/features/canvas/types'

const STATUS_VARIANT: Record<NodeStatus, StatusPillVariant> = {
  idle: 'pending',
  pending: 'pending',
  running: 'generating',
  success: 'rendered',
  failed: 'failed',
  cancelled: 'failed',
  stale: 'cached',
  skipped: 'pending',
  blocked: 'pending',
}

const STATUS_LABEL: Record<NodeStatus, string> = {
  idle: '空闲',
  pending: '待执行',
  running: '执行中',
  success: '已完成',
  failed: '失败',
  cancelled: '已取消',
  stale: '需更新',
  skipped: '已跳过',
  blocked: '等待降级确认',
}

/** 状态语义靠文本 + 图标共同表达，不只靠颜色；skipped 用 circle-slash（白名单）。 */
const STATUS_ICON: Partial<Record<NodeStatus, ComponentType<{ className?: string }>>> = {
  skipped: CircleSlash,
  blocked: TriangleAlert,
}

export function getNodeStatusPresentation(status: NodeStatus): {
  variant: StatusPillVariant
  label: string
  icon?: ComponentType<{ className?: string }>
} {
  return {
    variant: STATUS_VARIANT[status],
    label: STATUS_LABEL[status],
    ...(STATUS_ICON[status] ? { icon: STATUS_ICON[status] } : {}),
  }
}

export function getNodeStatusLabel(type: CanvasNodeType, status: NodeStatus): string {
  return type === 'shot-qa' && status === 'skipped'
    ? '已跳过 · 未验收'
    : STATUS_LABEL[status]
}

export const PIPELINE_NODE_TITLE: Record<CanvasNodeType, string> = {
  'script-import': '脚本导入',
  'shot-split': '语义拆分',
  score: '全局配乐',
  export: '合并导出',
  'shot-script': '分镜脚本',
  'shot-codegen': '代码生成',
  'shot-sfx': '音效',
  'shot-subtitle': '字幕',
  'shot-qa': '验收',
  'audio-transcribe': '录音转稿',
  'website-stage': '网站工作流',
}
