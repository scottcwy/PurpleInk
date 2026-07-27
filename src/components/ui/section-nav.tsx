'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { animate, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { DURATION, EASE } from '@/lib/motion/tokens'

export interface SectionNavItem {
  id: string
  label: string
}

export interface SectionNavProps {
  items: readonly SectionNavItem[]
  title?: string
  ariaLabel?: string
  className?: string
  /** 滚动容器引用；缺省时 fallback document.scrollingElement。 */
  scrollContainerRef?: RefObject<HTMLElement | null>
  /** 点击导航项回调（用于展开目标面板等外部副作用）。 */
  onNavigate?: (id: string) => void
}

/** 微发光持续时长（ms），之后自动淡出。 */
const GLOW_DURATION = 1200
/** 点击滚动期间抑制 IO 回写的时长（ms）。 */
const IO_SUPPRESS_MS = 400
/** 目标顶部与滚动区顶部的间距（px）。 */
const SCROLL_OFFSET = 20

/**
 * 单页锚点目录（本页导航），不是应用侧栏。
 * 纯文字竖排链接 + 微线条质感 + 下划线滑动选中态，刻意不带图标/行块底色，
 * 避免和 AppSidebar 的视觉语言混同。
 * 点击时 JS 缓动滚动嵌套滚动容器（原生锚点无法可靠滚动 overflow 容器）。
 */
export function SectionNav({
  items,
  title,
  ariaLabel = '本页导航',
  className,
  scrollContainerRef,
  onNavigate,
}: SectionNavProps) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? '')
  const itemIds = items.map((item) => item.id).join('|')
  const suppressIo = useRef(false)
  const scrollAnim = useRef<ReturnType<typeof animate> | null>(null)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    const targets = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null)
    if (targets.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (suppressIo.current) return
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

  function handleClick(id: string) {
    return (event: React.MouseEvent) => {
      event.preventDefault()
      setActiveId(id)
      onNavigate?.(id)

      suppressIo.current = true
      setTimeout(() => { suppressIo.current = false }, IO_SUPPRESS_MS)

      history.replaceState(null, '', `#${id}`)

      // 等一帧让面板展开动画启动后再测量目标位置。
      requestAnimationFrame(() => {
        scrollToSection(id)
      })
    }
  }

  function scrollToSection(id: string) {
    const target = document.getElementById(id)
    const container = scrollContainerRef?.current ?? document.scrollingElement
    if (!target || !container) return

    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const currentScroll = container.scrollTop
    const desired = targetRect.top - containerRect.top + currentScroll - SCROLL_OFFSET
    const maxScroll = container.scrollHeight - container.clientHeight
    const to = Math.max(0, Math.min(desired, maxScroll))

    scrollAnim.current?.stop()

    if (reducedMotion) {
      container.scrollTop = to
      triggerGlow(target)
      return
    }

    scrollAnim.current = animate(container.scrollTop, to, {
      duration: DURATION.slow,
      ease: EASE.emphasized,
      onUpdate: (value) => { container.scrollTop = value },
      onComplete: () => triggerGlow(target),
    })
  }

  function triggerGlow(target: HTMLElement) {
    target.classList.add('glow-active')
    setTimeout(() => target.classList.remove('glow-active'), GLOW_DURATION)
  }

  return (
    <nav aria-label={ariaLabel} className={cn('flex flex-col', className)}>
      {title && (
        <p className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-[0.16em] text-ds-text-muted uppercase">
          {title}
        </p>
      )}
      <div className="relative border-l border-ds-border">
        {items.map((item) => {
          const active = item.id === activeId
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              aria-current={active ? 'true' : undefined}
              onClick={handleClick(item.id)}
              className={cn(
                'relative block py-1.5 pl-3 pr-2 text-[13px] transition-colors duration-150 ease-out',
                active
                  ? 'font-semibold text-ds-blue'
                  : 'font-normal text-ds-text-muted hover:text-ds-text',
              )}
            >
              {item.label}
              {active && (
                <motion.span
                  layoutId="section-nav-underline"
                  transition={{ duration: DURATION.base, ease: EASE.emphasized }}
                  className="absolute right-2 bottom-0 left-3 h-[1.5px] rounded-full bg-ds-blue"
                  aria-hidden
                />
              )}
            </a>
          )
        })}
      </div>
    </nav>
  )
}
