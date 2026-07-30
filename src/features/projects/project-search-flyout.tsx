'use client'

import { AnimatePresence, motion } from 'motion/react'
import { Search } from 'lucide-react'
import { useRef, useState } from 'react'
import { SearchField } from '@/components/ui/search-field'
import { TRANSITION_ENTER, TRANSITION_EXIT } from '@/lib/motion/tokens'

/**
 * 顶栏搜索：图标常驻，悬浮/聚焦时输入框沿水平方向向右缓动展开；
 * 有关键词时保持展开，Escape 或失焦（无关键词）收起。
 */
export function ProjectSearchFlyout({
  query,
  onQueryChange,
}: {
  query: string
  onQueryChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const fieldRef = useRef<HTMLSpanElement>(null)
  const visible = open || query.trim().length > 0

  return (
    <span
      className="inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false)
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <button
        type="button"
        aria-label="搜索项目"
        aria-expanded={visible}
        onFocus={() => setOpen(true)}
        onClick={() => {
          setOpen(true)
          requestAnimationFrame(() =>
            fieldRef.current?.querySelector('input')?.focus(),
          )
        }}
        className="flex size-7 items-center justify-center rounded-md text-ds-text-muted transition-colors hover:bg-ds-surface-muted hover:text-ds-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring"
      >
        <Search className="size-4" />
      </button>
      <AnimatePresence initial={false}>
        {visible && (
          <motion.span
            key="field"
            ref={fieldRef}
            initial={{ width: 0, opacity: 0 }}
            animate={{
              width: 'auto',
              opacity: 1,
              transition: TRANSITION_ENTER,
            }}
            exit={{ width: 0, opacity: 0, transition: TRANSITION_EXIT }}
            className="inline-flex overflow-hidden"
          >
            <SearchField
              aria-label="搜索项目"
              placeholder="搜索全部项目"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              // 触发图标已在左侧，隐藏 SearchField 自带图标避免重复。
              className="ml-1.5 h-8 w-[240px] [&>svg]:hidden"
            />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
