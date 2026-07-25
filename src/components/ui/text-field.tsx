import type { InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

/**
 * 单行文本输入（带标签）。
 */
export function TextField({ label, className, ...props }: TextFieldProps) {
  return (
    <div className={cn('flex w-[280px] flex-col gap-1.5', className)}>
      {label && (
        <label className="text-[13px] font-normal text-label-secondary font-sc">
          {label}
        </label>
      )}
      <input
        className={cn(
          'h-9 w-full rounded-md border border-separator bg-surface px-3 py-2 text-[15px] font-sc text-label placeholder:text-label-tertiary focus:border-accent focus:outline-none',
        )}
        {...props}
      />
    </div>
  )
}
