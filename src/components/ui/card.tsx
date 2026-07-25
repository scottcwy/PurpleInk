import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** 卡片容器原语（token：surface 底 + separator 描边 + shadow-card + radius-lg）。 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-separator bg-surface p-4 shadow-card', className)}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold text-label', className)} {...props} />
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-2 text-sm text-label-secondary', className)} {...props} />
}
