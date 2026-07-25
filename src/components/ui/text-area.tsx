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
    <div className={cn('flex w-[280px] flex-col gap-1.5', className)}>
      {label && (
        <label className="text-[13px] font-normal text-label-secondary font-sc">
          {label}
        </label>
      )}
      <textarea
        className={cn(
          'min-h-[120px] w-full resize-none rounded-md border border-separator bg-surface px-3 py-2 text-[15px] font-sc text-label placeholder:text-label-tertiary focus:border-accent focus:outline-none',
        )}
        {...props}
      />
    </div>
  )
}
