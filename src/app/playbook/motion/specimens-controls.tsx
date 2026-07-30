'use client'

import { motion } from 'motion/react'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill } from '@/components/ui/status-pill'
import { SPRING_SPATIAL_FAST } from '@/lib/motion/tokens'
import { PILL_CLASS, Stage, StageNote } from './specimen-stage'

/**
 * 控件态与状态指示类标本（意图 1/2/3/15/16）。
 *
 * 状态类两条（15/16）直接渲染生产组件 StatusPill / Skeleton——
 * 手册所见即产品所跑。控件态三条演示目标参数，生产现状见卡片说明。
 */

/** 意图 1：hover 换底色。换底而非改亮度，见 design-quality-pitfalls.md §1.5。 */
export function HoverFill() {
  return (
    <Stage>
      <div className="absolute inset-2 flex flex-col gap-1">
        {['工作台', '项目', '设置'].map((item) => (
          <div
            key={item}
            className="hover:bg-ds-surface duration-fast ease-standard flex h-6 cursor-default items-center rounded-sm px-2 text-[11px] transition-colors"
          >
            {item}
          </div>
        ))}
      </div>
      <StageNote>悬停任意行 · 换底色，不是改亮度</StageNote>
    </Stage>
  )
}

/** 意图 2：active 按压。按下立即下压，松开走 spring 回弹。 */
export function ActivePress() {
  return (
    <Stage>
      <div className="absolute inset-0 grid place-items-center">
        <motion.button
          type="button"
          whileTap={{ y: 1 }}
          transition={SPRING_SPATIAL_FAST}
          className="ds-primary-button rounded-md px-3 py-1.5 text-xs font-medium"
        >
          按住我
        </motion.button>
      </div>
      <StageNote>按下不设时长，松开 spring 回弹</StageNote>
    </Stage>
  )
}

/** 意图 3：focus-visible ring。仅键盘聚焦可见，鼠标点击不出现。 */
export function FocusRing() {
  return (
    <Stage>
      <div className="absolute inset-0 grid place-items-center">
        <button type="button" className={PILL_CLASS}>
          Tab 聚焦我
        </button>
      </div>
      <StageNote>用键盘 Tab · 鼠标点击不应出现 ring</StageNote>
    </Stage>
  )
}

/** 意图 15：常驻状态指示。生产组件，动画关闭后文本仍在。 */
export function StatusIndicator() {
  return (
    <Stage>
      <div className="absolute inset-0 grid place-items-center">
        <StatusPill variant="generating" />
      </div>
      <StageNote>生产组件 · 关掉动画后「生成中」文本仍在</StageNote>
    </Stage>
  )
}

/** 意图 16：骨架占位。生产组件，禁止永久 Skeleton（须有终态或错误态）。 */
export function SkeletonSpecimen() {
  return (
    <Stage>
      <div className="absolute inset-3 space-y-2">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </Stage>
  )
}
