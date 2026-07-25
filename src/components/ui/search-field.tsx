import type { InputHTMLAttributes } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SearchFieldProps = InputHTMLAttributes<HTMLInputElement>

/**
 * 搜索输入框（SSOT）。
 * canvas.pen: fill 底、rounded-md、h-7、px-2.5、search 图标 14px。
 */
export function SearchField({ className, ...props }: SearchFieldProps) {
  return (
    <div
      className={cn(
        'inline-flex h-7 w-[220px] items-center gap-1.5 rounded-md bg-fill px-2.5 text-label-tertiary',
        className,
      )}
    >
      <Search className="h-3.5 w-3.5 shrink-0" />
      <input
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] font-sc text-label outline-none placeholder:text-label-tertiary"
        {...props}
      />
    </div>
  )
}
