import type { CanvasGraphNode } from '@/features/canvas'

export function isNodeActionBlocked(node: CanvasGraphNode): boolean {
  return (
    node.status === 'pending' ||
    node.status === 'running'
  )
}

export function nodeActionLabel(node: CanvasGraphNode): string {
  if (node.status === 'pending') return '等待执行'
  if (node.status === 'running') return '正在执行'
  if (
    node.status === 'failed' &&
    (node.directorError ?? node.renderError)?.retryable === false
  ) {
    return '重新检查配置并继续'
  }
  if (node.status === 'failed' || node.status === 'stale') return '修复并继续'
  if (node.status === 'success') {
    return node.type === 'shot-codegen'
      ? '重新渲染并更新下游'
      : '重新生成并更新下游'
  }
  return '执行此阶段'
}
