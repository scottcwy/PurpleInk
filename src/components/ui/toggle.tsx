import type { InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

/**
 * 开关（SSOT）。
 * canvas.pen: 44×26、rounded-pill；开启 success 底，关闭 fill 底；
 * knob 22×22 白色 + shadow-float。
 */
export function Toggle({ checked, onCheckedChange, className, ...props }: ToggleProps) {
  return (
    <label
      className={cn(
        'relative inline-flex h-[26px] w-11 cursor-pointer items-center rounded-pill transition-colors',
        checked ? 'bg-success' : 'bg-fill',
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
          'h-[22px] w-[22px] rounded-full bg-knob shadow-float transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </label>
  )
}
