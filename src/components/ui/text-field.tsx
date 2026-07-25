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
    <div className={cn('flex w-[360px] max-w-full flex-col gap-[7px]', className)}>
      {label && (
        <label className="text-[13px] font-medium text-ds-text">
          {label}
        </label>
      )}
      <input
        className={cn(
          'h-10 w-full rounded-md border border-ds-border bg-ds-surface px-3 py-[9px] text-sm text-ds-text placeholder:text-ds-text-muted focus:border-ds-blue focus:outline-none',
        )}
        {...props}
      />
    </div>
  )
}
