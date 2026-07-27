'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export interface SectionNavItem {
  id: string
  label: string
}

export interface SectionNavProps {
  items: readonly SectionNavItem[]
  title?: string
  ariaLabel?: string
  className?: string
}

/**
 * 单页锚点目录（本页导航），不是应用侧栏。
 * 纯文字竖排链接 + 左侧细竖线标记当前项，刻意不带图标/行块底色，
 * 避免和 AppSidebar 的视觉语言混同。
 */
export function SectionNav({
  items,
  title,
  ariaLabel = '本页导航',
  className,
}: SectionNavProps) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? '')
  const itemIds = items.map((item) => item.id).join('|')

  useEffect(() => {
    const targets = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null)
    if (targets.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    )
    for (const target of targets) observer.observe(target)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemIds])

  return (
    <nav aria-label={ariaLabel} className={cn('flex flex-col gap-1', className)}>
      {title && (
        <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-[0.16em] text-ds-text-muted uppercase">
          {title}
        </p>
      )}
      {items.map((item) => {
        const active = item.id === activeId
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'rounded-sm border-l-2 py-1 pl-2.5 pr-2 text-[13px] transition-colors duration-150 ease-out',
              active
                ? 'border-ds-blue font-semibold text-ds-text'
                : 'border-transparent font-normal text-ds-text-muted hover:text-ds-text',
            )}
          >
            {item.label}
          </a>
        )
      })}
    </nav>
  )
}
