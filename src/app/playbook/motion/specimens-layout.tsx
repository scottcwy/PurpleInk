'use client'

import { useState } from 'react'
import { motion } from 'motion/react'
import { fadeInUp } from '@/lib/motion/variants'
import {
  SPRING_SPATIAL_DEFAULT,
  SPRING_SPATIAL_FAST,
  TRANSITION_NARRATIVE,
} from '@/lib/motion/tokens'
import { cn } from '@/lib/utils'
import { Replay, Stage, StageNote, Toggle } from './specimen-stage'

/**
 * 布局、转场与编排类标本（意图 4/11/12/13/14/17）。
 *
 * 意图 12（路由转场）与 14（拖拽跟手）已统一，直接复用生产 variants / 参数；
 * 其余演示目标参数。
 */

/** 意图 4：折叠展开。高度是 spatial，允许 overshoot。 */
export function Collapse() {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-2">
      <Toggle on={open} onToggle={() => setOpen((v) => !v)} onLabel="收起" offLabel="展开" />
      <div className="bg-ds-surface-muted border-ds-border min-h-12 overflow-hidden rounded-md border">
        <motion.div
          initial={false}
          animate={{ height: open ? 'auto' : 0 }}
          transition={SPRING_SPATIAL_DEFAULT}
          className="overflow-hidden"
        >
          <div className="p-2 text-[11px] leading-5">
            折叠内容。高度变化走 spring；内容淡入属 effects，不用 spring。
          </div>
        </motion.div>
      </div>
    </div>
  )
}

/** 意图 11：列表 stagger。上限 6 项，第 7 项起不再递增延迟。 */
export function Stagger() {
  const [run, setRun] = useState(0)
  return (
    <div className="space-y-2">
      <Replay onClick={() => setRun((v) => v + 1)} />
      <Stage>
        <div key={run} className="absolute inset-2 flex flex-wrap gap-1.5">
          {Array.from({ length: 8 }, (_, index) => (
            <motion.span
              key={index}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING_SPATIAL_FAST, delay: Math.min(index, 5) * 0.04 }}
              className={cn(
                'size-5 rounded-sm',
                index >= 6 ? 'bg-ds-text-muted' : 'bg-ds-blue',
              )}
            />
          ))}
        </div>
        <StageNote>灰色两项是第 7、8 项 · 与第 6 项同时到达</StageNote>
      </Stage>
    </div>
  )
}

/** 意图 12：路由转场。复用生产 fadeInUp（products/(app)/template.tsx 同一份）。 */
export function RouteTransition() {
  const [run, setRun] = useState(0)
  return (
    <div className="space-y-2">
      <Replay onClick={() => setRun((v) => v + 1)} />
      <Stage>
        <motion.div
          key={run}
          variants={fadeInUp}
          initial="hidden"
          animate="visible"
          className="bg-ds-surface absolute inset-2 grid place-items-center rounded-sm text-[11px]"
        >
          页面内容
        </motion.div>
        <StageNote>复用生产 fadeInUp · y 位移仅 8px</StageNote>
      </Stage>
    </div>
  )
}

/** 意图 13：侧栏 / 面板宽度变化。 */
export function PanelWidth() {
  const [wide, setWide] = useState(true)
  return (
    <div className="space-y-2">
      <Toggle on={wide} onToggle={() => setWide((v) => !v)} onLabel="收起" offLabel="展开" />
      <Stage>
        <motion.div
          initial={false}
          animate={{ width: wide ? 160 : 48 }}
          transition={SPRING_SPATIAL_DEFAULT}
          className="bg-ds-surface border-ds-border absolute inset-y-0 left-0 overflow-hidden border-r p-2 text-[11px]"
        >
          侧栏
        </motion.div>
      </Stage>
    </div>
  )
}

/** 意图 14：拖拽跟手。零动画，1:1 跟随指针。 */
export function DragInstant() {
  return (
    <Stage>
      <div className="absolute inset-0 grid place-items-center">
        <motion.div
          drag="x"
          dragMomentum={false}
          dragElastic={0}
          dragConstraints={{ left: -80, right: 80 }}
          className="bg-ds-blue size-8 cursor-grab rounded-sm active:cursor-grabbing"
        />
      </div>
      <StageNote>左右拖动 · 零动画，无惯性、无回弹</StageNote>
    </Stage>
  )
}

/** 意图 17：营销叙事进入。仅 (marketing) 段可用。 */
export function Narrative() {
  const [run, setRun] = useState(0)
  return (
    <div className="space-y-2">
      <Replay onClick={() => setRun((v) => v + 1)} />
      <Stage>
        <motion.div
          key={run}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={TRANSITION_NARRATIVE}
          className="bg-ds-surface absolute inset-2 grid place-items-center rounded-sm text-[11px]"
        >
          营销叙事 · 300ms
        </motion.div>
        <StageNote>比意图 12 更慢更舒展 · 应用壳内禁用</StageNote>
      </Stage>
    </div>
  )
}
