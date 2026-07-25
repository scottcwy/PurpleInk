import type { InputHTMLAttributes } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SearchFieldProps = InputHTMLAttributes<HTMLInputElement>

/**
 * 搜索输入框（SSOT）。
 * canvas.pen Canonical: ds-surface 底、6px 圆角、高 40px。
 */
export function SearchField({ className, ...props }: SearchFieldProps) {
  return (
    <div
      className={cn(
        'inline-flex h-10 w-[260px] max-w-full items-center gap-2 rounded-md border border-ds-border bg-ds-surface px-3 text-ds-text-muted',
        className,
      )}
    >
      <Search className="size-4 shrink-0" />
      <input
        className="h-full min-w-0 flex-1 bg-transparent text-sm text-ds-text outline-none placeholder:text-ds-text-muted"
        {...props}
      />
    </div>
  )
}
