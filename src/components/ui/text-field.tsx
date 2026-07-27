import type { InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  /**
   * default：带边框的标准输入框；
   * ghost：无边框、柔和底色，focus 时圆角光晕——用于卡片内嵌表单。
   */
  variant?: 'default' | 'ghost'
}

/**
 * 单行文本输入（带标签）。
 */
export function TextField({ label, className, variant = 'default', ...props }: TextFieldProps) {
  return (
    <div className={cn('flex w-[360px] max-w-full flex-col gap-[7px]', className)}>
      {label && (
        <label className="text-[13px] font-medium text-ds-text">
          {label}
        </label>
      )}
      <input
        className={cn(
          'h-10 w-full px-3 py-[9px] text-sm text-ds-text placeholder:text-ds-text-muted focus:outline-none',
          variant === 'default'
            ? 'rounded-md border border-ds-border bg-ds-surface focus:border-ds-blue'
            : 'rounded-lg border border-transparent bg-ds-surface-muted transition-[border-color,box-shadow] duration-150 hover:border-ds-border focus:border-transparent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ds-blue)_22%,transparent)]',
        )}
        {...props}
      />
    </div>
  )
}
