import type { InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

/**
 * 开关（SSOT）。
 * canvas.pen Canonical: 40×22、rounded-pill；开启 primary 底；
 * knob 18×18 白色。未开启态带 1px border 保证白底上的边界感。
 */
export function Toggle({ checked, onCheckedChange, className, ...props }: ToggleProps) {
  return (
    <label
      className={cn(
        'relative inline-flex h-[22px] w-10 cursor-pointer items-center rounded-full border p-0.5 transition-[background-color,border-color,box-shadow] duration-fast has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ds-ring',
        checked
          ? 'border-transparent bg-ds-primary'
          : 'border-ds-border bg-ds-surface-muted',
        className,
      )}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        {...props}
      />
      <span
        className={cn(
          'size-[18px] rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0',
        )}
      />
    </label>
  )
}
