/**
 * 动效意图登记表。与 docs/conventions/motion-interaction.md §3 逐条对应。
 *
 * 按「用户在做什么」组织，而非按参数组织——写代码时想的是「我要做一个抽屉」，
 * 不是「我要找一个 220ms」。新增意图必须同批改规范 §3 与本表，并在
 * intent-specimens.tsx 落标本（routing.md §2.4 约束）。
 *
 * `status` 是真实迁移状态，不是理想状态：
 * - `unified`：生产代码已使用本表参数，标本即生产行为。
 * - `pending`：标本演示的是**目标**参数，生产现状见 `current`。
 *   禁止把 pending 标注成 unified —— 那会让手册变成"看起来核对过了"的假象。
 */

export type MotionIntentCategory = 'spatial' | 'effects' | 'mixed' | 'none'
export type MotionIntentStatus = 'unified' | 'pending'

export interface MotionIntent {
  /** 与 intent-specimens.tsx 的 SPECIMENS 键一致。 */
  id: string
  /** 规范 §3 的行号。 */
  no: number
  title: string
  category: MotionIntentCategory
  /** 目标参数，人类可读。 */
  params: string
  status: MotionIntentStatus
  /** status 为 pending 时必填：生产现状与偏差。 */
  current?: string
}

export const MOTION_INTENTS: MotionIntent[] = [
  {
    id: 'hover-fill',
    no: 1,
    title: 'hover 换底色',
    category: 'effects',
    params: 'duration-fast + ease-standard',
    status: 'unified',
  },
  {
    id: 'active-press',
    no: 2,
    title: 'active 按压',
    category: 'spatial',
    params: '按下 0ms 立即下压，松开 SPRING_SPATIAL_FAST',
    status: 'unified',
  },
  {
    id: 'focus-ring',
    no: 3,
    title: 'focus-visible ring',
    category: 'effects',
    params: 'duration-fast + ease-standard',
    status: 'unified',
  },
  {
    id: 'collapse',
    no: 4,
    title: '折叠展开 / 收起',
    category: 'spatial',
    params: 'SPRING_SPATIAL_DEFAULT',
    status: 'unified',
  },
  {
    id: 'drawer-enter',
    no: 5,
    title: '抽屉进',
    category: 'spatial',
    params: 'SPRING_SPATIAL_DEFAULT',
    status: 'pending',
    current: 'DrawerOverlay 用 TRANSITION_ENTER（tween base+emphasized）。是唯一做对进出场编排的实现，只需换参数',
  },
  {
    id: 'drawer-exit',
    no: 6,
    title: '抽屉出',
    category: 'effects',
    params: 'duration-base + ease-exit（退出不弹）',
    status: 'pending',
    current: 'DrawerOverlay 用 TRANSITION_EXIT（fast+exit），比目标略快',
  },
  {
    id: 'scrim',
    no: 7,
    title: '遮罩 scrim 进 / 出',
    category: 'effects',
    params: '进 base+emphasized / 出 fast+exit',
    status: 'unified',
  },
  {
    id: 'popover-enter',
    no: 8,
    title: 'Popover / 菜单进',
    category: 'mixed',
    params: 'scale .96→1 SPRING_SPATIAL_FAST + opacity fast',
    status: 'unified',
  },
  {
    id: 'tooltip',
    no: 9,
    title: 'Tooltip',
    category: 'effects',
    params: '延迟 300ms 进 / 0ms 出，淡入 fast',
    status: 'unified',
  },
  {
    id: 'toast',
    no: 10,
    title: 'Toast 进 / 出',
    category: 'spatial',
    params: '进 SPRING_SPATIAL_DEFAULT / 出 fast+exit',
    status: 'pending',
    current: 'ui/toast.tsx 无动画、无 viewport、无 portal，且不会自动消失',
  },
  {
    id: 'stagger',
    no: 11,
    title: '列表 stagger',
    category: 'none',
    params: '40ms/项，上限 6 项',
    status: 'pending',
    current: '仅营销层有 stagger（且其实现已是死代码），应用层无',
  },
  {
    id: 'route-transition',
    no: 12,
    title: '路由转场',
    category: 'spatial',
    params: 'fadeInUp（y: 8）+ base + emphasized',
    status: 'unified',
  },
  {
    id: 'panel-width',
    no: 13,
    title: '侧栏 / 面板宽度变化',
    category: 'spatial',
    params: 'SPRING_SPATIAL_DEFAULT',
    status: 'pending',
    current: '生产与 playbook demo 均由 AnimatedAside 使用 tween 220ms，已删除 sidebar.tsx 被 w-full 覆盖的 CSS 200ms 死分支；是否改为 spring 属计划外，仍待真实收益判断',
  },
  {
    id: 'drag-instant',
    no: 14,
    title: '拖拽跟手',
    category: 'none',
    params: 'TRANSITION_INSTANT（0ms）',
    status: 'unified',
  },
  {
    id: 'status-indicator',
    no: 15,
    title: '常驻状态指示（进行中）',
    category: 'none',
    params: 'animate-pulse / animate-spin，必须有文本或图标语义并行',
    status: 'unified',
  },
  {
    id: 'skeleton',
    no: 16,
    title: '骨架占位',
    category: 'none',
    params: 'animate-shimmer，禁止永久 Skeleton',
    status: 'unified',
  },
  {
    id: 'narrative',
    no: 17,
    title: '营销叙事进入',
    category: 'spatial',
    params: 'duration-narrative（300ms）+ ease-emphasized，仅 (marketing) 入场叙事',
    status: 'unified',
  },
]

export const MOTION_INTENT_COUNT = MOTION_INTENTS.length

export function countMotionIntents(status: MotionIntentStatus): number {
  return MOTION_INTENTS.filter((intent) => intent.status === status).length
}
