import type { ComponentType } from 'react'
import {
  ActivePress,
  FocusRing,
  HoverFill,
  SkeletonSpecimen,
  StatusIndicator,
} from './specimens-controls'
import {
  Drawer,
  PopoverEnter,
  Scrim,
  Toast,
  TooltipSpecimen,
} from './specimens-overlays'
import {
  Collapse,
  DragInstant,
  Narrative,
  PanelWidth,
  RouteTransition,
  Stagger,
} from './specimens-layout'

/**
 * 意图 id → 标本组件的登记映射。
 * 与 src/app/playbook/registry.ts 同模式：登记表与标本实现分离，
 * 标本按职责分文件（controls / overlays / layout），本文件只负责登记。
 *
 * 键必须与 motion-intents.ts 的 MotionIntent.id 一致；缺键时对照台会显式
 * 渲染「标本未登记」而不是静默跳过。
 */
export const SPECIMENS: Record<string, ComponentType> = {
  // 控件态与状态指示
  'hover-fill': HoverFill,
  'active-press': ActivePress,
  'focus-ring': FocusRing,
  'status-indicator': StatusIndicator,
  skeleton: SkeletonSpecimen,
  // 覆盖层
  'drawer-enter': function DrawerEnter() {
    return <Drawer phase="enter" />
  },
  'drawer-exit': function DrawerExit() {
    return <Drawer phase="exit" />
  },
  scrim: Scrim,
  'popover-enter': PopoverEnter,
  tooltip: TooltipSpecimen,
  toast: Toast,
  // 布局、转场与编排
  collapse: Collapse,
  stagger: Stagger,
  'route-transition': RouteTransition,
  'panel-width': PanelWidth,
  'drag-instant': DragInstant,
  narrative: Narrative,
}
