import type { CanvasGraphNode } from '@/features/canvas'

export function isNodeActionBlocked(node: CanvasGraphNode): boolean {
  return (
    node.status === 'pending' ||
    node.status === 'running' ||
    node.status === 'blocked'
  )
}

export function nodeActionLabel(node: CanvasGraphNode): string {
  if (node.status === 'pending') return '等待执行'
  if (node.status === 'running') return '正在执行'
  if (node.status === 'blocked' && node.type === 'export') {
    return '前往导出页确认'
  }
  if (
    node.status === 'failed' &&
    (node.directorError ?? node.renderError)?.retryable === false
  ) {
    return '重新检查配置并继续'
  }
  if (node.status === 'failed' || node.status === 'stale') return '修复并继续'
  // 已跳过节点可随时重新执行恢复真实产出（routing.md 跳过合同）。
  if (node.status === 'skipped') return '重新执行以恢复此环节'
  if (node.status === 'success') {
    return node.type === 'shot-codegen'
      ? '重新渲染并更新下游'
      : '重新生成并更新下游'
  }
  return '执行此阶段'
}
