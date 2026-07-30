'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { scrimFade } from '@/lib/motion/variants'
import { SPRING_SPATIAL_DEFAULT, SPRING_SPATIAL_FAST, TRANSITION_EXIT } from '@/lib/motion/tokens'
import { cn } from '@/lib/utils'
import { PILL_CLASS, Stage, StageNote, Toggle } from './specimen-stage'

/**
 * 覆盖层类标本（意图 5/6/7/8/9/10）。
 *
 * 这些是**动效标本**，不是覆盖层原语标本：舞台内的面板没有 top layer、
 * focus trap 或 scroll lock。这些能力属于 OverlayRoot（规范 §4，尚未落地），
 * 到位后本文件的标本改为直接消费它。
 *
 * 意图 7（scrim）已统一，复用生产 variants scrimFade；其余演示目标参数。
 */

/** 意图 5/6：抽屉进 / 出。进场 spring 有落位感，退场 tween 不回弹。 */
export function Drawer({ phase }: { phase: 'enter' | 'exit' }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-2">
      <Toggle on={open} onToggle={() => setOpen((v) => !v)} onLabel="关闭" offLabel="打开" />
      <Stage>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={phase === 'enter' ? SPRING_SPATIAL_DEFAULT : TRANSITION_EXIT}
              className="bg-ds-surface border-ds-border shadow-float absolute inset-y-0 right-0 w-2/3 border-l p-2 text-[11px]"
            >
              {phase === 'enter'
                ? '进场：spring 末段有落位感'
                : '退场：tween 加速冲出，不回弹'}
            </motion.div>
          )}
        </AnimatePresence>
      </Stage>
      <StageNote>
        {phase === 'enter' ? '看「打开」时的落位' : '看「关闭」时不回弹'}
      </StageNote>
    </div>
  )
}

/** 意图 7：遮罩 scrim 进 / 出。复用生产 variants。 */
export function Scrim() {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-2">
      <Toggle on={open} onToggle={() => setOpen((v) => !v)} onLabel="隐藏" offLabel="显示" />
      <Stage>
        <div className="absolute inset-0 grid place-items-center text-[11px]">底层内容</div>
        <AnimatePresence>
          {open && (
            <motion.div
              className="bg-scrim absolute inset-0"
              variants={scrimFade}
              initial="hidden"
              animate="visible"
              exit="exit"
            />
          )}
        </AnimatePresence>
      </Stage>
    </div>
  )
}

/** 意图 8：Popover / 菜单进。scale 走 spring，opacity 走 tween（effects 禁 spring）。 */
export function PopoverEnter() {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-2">
      <Toggle on={open} onToggle={() => setOpen((v) => !v)} onLabel="收起" offLabel="弹出" />
      <Stage>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              // 值级过渡：scale 用 spring，opacity 单独用 tween。
              transition={{ default: SPRING_SPATIAL_FAST, opacity: TRANSITION_EXIT }}
              className="bg-ds-surface border-ds-border shadow-float absolute top-3 left-3 rounded-md border p-2 text-[11px]"
            >
              菜单项
            </motion.div>
          )}
        </AnimatePresence>
      </Stage>
      <StageNote>scale 弹，opacity 不弹</StageNote>
    </div>
  )
}

/** 意图 9：Tooltip。延迟 300ms 进、0ms 出，避免鼠标扫过即闪。 */
export function TooltipSpecimen() {
  return (
    <Stage>
      <div className="absolute inset-0 grid place-items-center">
        <span className="group relative inline-flex">
          <span className={cn(PILL_CLASS, 'cursor-default')}>悬停我</span>
          <span className="bg-tooltip-bg text-on-accent duration-fast ease-standard pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded-sm px-2 py-1 text-[10px] whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100 group-hover:delay-300">
            延迟 300ms 才出现
          </span>
        </span>
      </div>
      <StageNote>停住才出现，移开立即消失</StageNote>
    </Stage>
  )
}

/** 意图 10：Toast 进 / 出。进 spring，出 tween。 */
export function Toast() {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-2">
      <Toggle on={open} onToggle={() => setOpen((v) => !v)} onLabel="收回" offLabel="弹出" />
      <Stage>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12, transition: TRANSITION_EXIT }}
              transition={SPRING_SPATIAL_DEFAULT}
              className="bg-ds-surface border-ds-border shadow-float absolute inset-x-2 bottom-2 rounded-md border p-2 text-[11px]"
            >
              已保存
            </motion.div>
          )}
        </AnimatePresence>
      </Stage>
    </div>
  )
}
