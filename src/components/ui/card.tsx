import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** 卡片容器原语（Canonical ds surface + border + radius 8）。 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-ds-border bg-ds-surface p-5 text-ds-text', className)}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold text-ds-text', className)} {...props} />
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-2 text-sm text-ds-text-muted', className)} {...props} />
}
