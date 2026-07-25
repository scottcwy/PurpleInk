'use client'

import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { collapse } from '@/lib/motion/variants'
import { TRANSITION_BASE } from '@/lib/motion/tokens'
import { cn } from '@/lib/utils'

export interface CollapsibleCardProps {
  /** 头部标题。 */
  title: ReactNode
  /** 头部前置图标（Lucide 白名单）。 */
  icon?: LucideIcon
  /** 头部右侧元信息（如字符数）。 */
  meta?: ReactNode
  /** 非受控初始展开态。默认展开。 */
  defaultOpen?: boolean
  /** 受控展开态；提供时组件不自管理开合。 */
  open?: boolean
  /** 展开态变化回调。 */
  onOpenChange?: (open: boolean) => void
  className?: string
  /** 内容区。 */
  children: ReactNode
}

/**
 * 可折叠卡片（SSOT）。
 * canvas.pen `CollapsibleCard`：surface 底、rounded-md、separator 描边、
 * shadow-card、垂直布局；头部（前置图标 + 标题 + 元信息 + chevron）可点击
 * 展开/收起，内容区经 motion `collapse` variant 缓动高度，跟随 prefers-reduced-motion。
 */
export function CollapsibleCard({
  title,
  icon: Icon,
  meta,
  defaultOpen = true,
  open,
  onOpenChange,
  className,
  children,
}: CollapsibleCardProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen

  function toggle() {
    const next = !isOpen
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-separator bg-surface shadow-card',
        className,
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {Icon && <Icon className="h-4 w-4 shrink-0 text-accent" />}
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold font-sc text-label">
          {title}
        </span>
        {meta && <span className="shrink-0 font-mono text-[11px] text-label-tertiary">{meta}</span>}
        <motion.span
          animate={{ rotate: isOpen ? 0 : -90 }}
          transition={TRANSITION_BASE}
          className="shrink-0"
        >
          <ChevronDown className="h-4 w-4 text-label-tertiary" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="body"
            variants={collapse}
            initial="hidden"
            animate="visible"
            exit="hidden"
            className="overflow-hidden"
          >
            <div className="border-t border-separator px-3 py-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
