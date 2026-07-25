import type { TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
}

/**
 * 多行文本输入（带标签）。
 */
export function TextArea({ label, className, ...props }: TextAreaProps) {
  return (
    <div className={cn('flex w-[520px] max-w-full flex-col gap-[7px]', className)}>
      {label && (
        <label className="text-[13px] font-medium text-ds-text font-sc">
          {label}
        </label>
      )}
      <textarea
        className={cn(
          'min-h-[120px] w-full resize-none rounded-md border border-ds-border bg-ds-surface p-3 text-sm leading-[1.5] font-sc text-ds-text placeholder:text-ds-text-muted focus:border-ds-blue focus:outline-none',
        )}
        {...props}
      />
    </div>
  )
}
