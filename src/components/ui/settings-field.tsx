import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SettingsFieldProps {
  label: string
  /** 辅助说明（12px）；错误态传 hintTone="danger"。 */
  hint?: ReactNode
  hintTone?: 'muted' | 'danger'
  children?: ReactNode
  className?: string
}

/**
 * 设置表单行（SSOT）。
 * 左侧 label（14px medium）+ 可选 hint（12px），右侧控件区（允许换行）；
 * 窄屏纵向堆叠。用于吸收"行内塞 input / Pill / 按钮多控件"的表单场景，
 * 取代对 SettingsRow 的行高覆写；导航/只读信息行继续用 SettingsRow。
 */
export function SettingsField({
  label,
  hint,
  hintTone = 'muted',
  children,
  className,
}: SettingsFieldProps) {
  return (
    <div
      className={cn(
        'flex min-h-14 min-w-0 flex-col justify-center gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4',
        className,
      )}
    >
      <div className="min-w-0 shrink-0">
        <span className="block text-sm font-medium text-ds-text">{label}</span>
        {hint && (
          <span
            className={cn(
              'mt-0.5 block text-xs leading-5',
              hintTone === 'danger' ? 'text-ds-red' : 'text-ds-text-muted',
            )}
          >
            {hint}
          </span>
        )}
      </div>
      {children && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          {children}
        </div>
      )}
    </div>
  )
}
