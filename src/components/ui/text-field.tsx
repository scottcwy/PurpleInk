'use client'

import { useId, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  /**
   * default：带边框的标准输入框；
   * ghost：无边框、柔和底色，focus 时圆角光晕——用于卡片内嵌表单。
   */
  variant?: 'default' | 'ghost'
  /** opt-in 校验错误：红边框 + 下方错误文本 + aria-invalid/aria-describedby。 */
  error?: string
  /** 常驻灰色说明文本。与 error 互斥显示，error 优先。 */
  hint?: string
}

/**
 * 单行文本输入（带标签）。
 *
 * `error` / `hint` 均不传时渲染结果与历史版本完全一致，既有调用点零影响。
 * 错误文本淡入对应动效规范 §3 意图 3 的 effects 参数（`fast` + `standard`）。
 */
export function TextField({
  label,
  className,
  variant = 'default',
  error,
  hint,
  ...props
}: TextFieldProps) {
  const errorId = useId()
  const invalid = Boolean(error)
  return (
    <div className={cn('flex w-[360px] max-w-full flex-col gap-[7px]', className)}>
      {label && (
        <label className="text-[13px] font-medium text-ds-text">
          {label}
        </label>
      )}
      <input
        className={cn(
          'h-10 w-full rounded-md px-3 py-[9px] text-sm text-ds-text placeholder:text-ds-text-muted focus:outline-none',
          variant === 'default'
            ? 'border border-ds-border bg-ds-surface transition-[border-color,box-shadow] duration-fast hover:border-ds-blue/40 focus:border-ds-blue focus:ring-[3px] focus:ring-ds-blue/20'
            : 'border border-transparent bg-ds-surface-muted transition-[border-color,box-shadow] duration-fast hover:border-ds-border focus:border-ds-blue focus:bg-ds-surface focus:ring-[3px] focus:ring-ds-blue/20',
          invalid && 'border-ds-red hover:border-ds-red focus:border-ds-red focus:ring-ds-red/20',
        )}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        {...props}
      />
      {invalid ? (
        <p
          id={errorId}
          className="text-xs text-ds-red opacity-100 transition-opacity duration-fast ease-standard starting:opacity-0"
        >
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-ds-text-muted">{hint}</p>
      )}
    </div>
  )
}
