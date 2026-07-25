import type { ComponentType, ReactNode } from 'react'
import Link from 'next/link'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface NavItemProps {
  icon: ComponentType<{ className?: string }>
  children: ReactNode
  active?: boolean
  href?: string
  className?: string
  /** 图标条态：隐藏文字，用 Tooltip 显示标签 */
  compact?: boolean
}

/**
 * 导航项（SSOT）。
 * canvas.pen: 32px 高、rounded-sm、gap-2、px-2.5 py-1.5；
 * active 时 fill-strong 底 + accent 图标 + label 加粗字。
 */
export function NavItem({
  icon: Icon,
  children,
  active,
  href,
  className,
  compact,
}: NavItemProps) {
  const icon = (
    <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-accent' : 'text-label-secondary')} />
  )

  const content = compact ? (
    icon
  ) : (
    <>
      {icon}
      <span
        className={cn(
          'text-[13px] font-sc',
          active ? 'font-semibold text-label' : 'font-normal text-label-secondary',
        )}
      >
        {children}
      </span>
    </>
  )

  const classes = cn(
    'flex h-8 items-center rounded-sm transition-colors duration-[var(--duration-fast)] ease-standard',
    compact ? 'w-8 justify-center px-0' : 'gap-2 px-2.5 py-1.5',
    active ? 'bg-fill-strong' : 'bg-transparent',
    className,
  )

  const node = href ? (
    <Link href={href} aria-current={active ? 'page' : undefined} className={classes}>
      {content}
    </Link>
  ) : (
    <div className={classes}>{content}</div>
  )

  if (compact) {
    return (
      <Tooltip content={children} className="w-full justify-center">
        {node}
      </Tooltip>
    )
  }

  return node
}
