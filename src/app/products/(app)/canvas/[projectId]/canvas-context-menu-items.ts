import {
  CircleSlash,
  Maximize2,
  Minimize2,
  RefreshCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { ContextMenuItem } from '@/components/ui/context-menu'
import type { CanvasGraphNode } from '@/features/canvas'
import { isNodeActionBlocked, nodeActionLabel } from './node-action-presentation'

export interface NodeMenuHandlers {
  /** 复用 inspector 同一条链路（triggerNodeAction）。 */
  onRerender: () => void
  /** 复用 intent=cancel-wait，只取消尚未领取的 Provider 等待。 */
  onStop: () => void
  onCancel: () => void
}

/**
 * 单节点右键菜单项。只暴露既有能力：
 * - 重新渲染 → triggerNodeAction，可用性沿用 `isNodeActionBlocked`
 * - 停止 → triggerCancelProviderWait，仅在节点确有可取消的 Provider 等待时可用
 *   （与 streaming-log-card 的 `executionNotice ? onCancelWait : undefined` 同条件）
 * - 取消 → 仅关闭菜单，无副作用
 */
export function buildNodeMenuItems(
  node: CanvasGraphNode,
  handlers: NodeMenuHandlers,
  submitting = false,
): ContextMenuItem[] {
  const blocked = isNodeActionBlocked(node)
  const waiting = Boolean(node.executionNotice)
  return [
    {
      id: 'rerender',
      label: '重新渲染',
      icon: RefreshCw,
      disabled: submitting || blocked,
      ...(blocked ? { disabledReason: nodeActionLabel(node) } : {}),
      onSelect: handlers.onRerender,
    },
    {
      id: 'stop',
      label: '停止',
      icon: CircleSlash,
      disabled: submitting || !waiting,
      ...(waiting ? {} : { disabledReason: '无等待可取消' }),
      onSelect: handlers.onStop,
    },
    { type: 'separator', id: 'node-sep' },
    {
      id: 'cancel',
      label: '取消',
      icon: X,
      onSelect: handlers.onCancel,
    },
  ]
}

export interface PaneMenuState {
  minZoomReached: boolean
  maxZoomReached: boolean
  isFullscreen: boolean
  fullscreenSupported: boolean
}

export interface PaneMenuHandlers {
  onZoomIn: () => void
  onZoomOut: () => void
  onFitView: () => void
  onToggleFullscreen: () => void
}

/**
 * 画布空白处右键菜单项。放大 / 缩小 / 适应视图复用视口工具条的同一批
 * `useReactFlow` 能力与同一套 zoom 边界判断；全屏是本次唯一新增的视图能力。
 */
export function buildPaneMenuItems(
  state: PaneMenuState,
  handlers: PaneMenuHandlers,
): ContextMenuItem[] {
  return [
    {
      id: 'zoom-in',
      label: '放大',
      icon: ZoomIn,
      disabled: state.maxZoomReached,
      ...(state.maxZoomReached ? { disabledReason: '已最大' } : {}),
      onSelect: handlers.onZoomIn,
    },
    {
      id: 'zoom-out',
      label: '缩小',
      icon: ZoomOut,
      disabled: state.minZoomReached,
      ...(state.minZoomReached ? { disabledReason: '已最小' } : {}),
      onSelect: handlers.onZoomOut,
    },
    {
      id: 'fit-view',
      label: '适应视图',
      icon: Maximize2,
      onSelect: handlers.onFitView,
    },
    { type: 'separator', id: 'pane-sep' },
    {
      id: 'fullscreen',
      label: state.isFullscreen ? '退出全屏' : '全屏模式',
      icon: state.isFullscreen ? Minimize2 : Maximize2,
      disabled: !state.fullscreenSupported,
      ...(state.fullscreenSupported ? {} : { disabledReason: '浏览器不支持' }),
      onSelect: handlers.onToggleFullscreen,
    },
  ]
}
