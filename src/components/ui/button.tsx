import type { ButtonHTMLAttributes, ComponentType } from 'react'
import { cn } from '@/lib/utils'

/**
 * 设计系统 4 变体（见 design-system-inventory §4 B1）：
 * - primary: 主 CTA（accent 底 + on-accent 字）
 * - tinted: 次主操作（accent-fill 底 + accent 字）
 * - gray: 取消 / 次级（fill 底 + label 字）
 * - destructive: 破坏性（danger 底 + on-accent 字）
 */
export type ButtonVariant = 'primary' | 'tinted' | 'gray' | 'destructive'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ComponentType<{ className?: string }>
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:opacity-90',
  tinted: 'bg-accent-fill text-accent hover:opacity-80',
  gray: 'bg-fill text-label hover:bg-fill-strong',
  destructive: 'bg-danger text-on-accent hover:opacity-90',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1 px-3 text-[13px] rounded-sm',
  md: 'h-9 gap-1.5 px-4 text-[15px] rounded-sm',
  lg: 'h-10 gap-1.5 px-5 text-[15px] rounded-md',
}

/**
 * 基础按钮原语（SSOT：全应用统一从此处 import）。
 * 属应用 UI —— 允许 hover / transition 等交互动效（不受视频确定性红线约束）。
 */
export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-semibold font-sc transition-colors disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      {children}
    </button>
  )
}
