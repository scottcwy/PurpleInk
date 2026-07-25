import type { ButtonHTMLAttributes, ComponentType } from 'react'
import { cn } from '@/lib/utils'

/**
 * 设计系统 4 变体（见 design-system-inventory §4.3）：
 * - primary: 主 CTA（主题化渐变：浅色模式浅色系 / 暗色模式深色系）— 新建项目、导出
 * - tinted: 次主操作（blue-soft 底 + blue 字）— 执行此阶段、生成分镜代码
 * - gray: 取消 / 次级
 * - destructive: 高代价操作（red）— 重渲此镜、删除
 */
export type ButtonVariant = 'primary' | 'tinted' | 'gray' | 'destructive'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ComponentType<{ className?: string }>
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'ds-primary-button text-white hover:brightness-105',
  tinted: 'bg-ds-blue-soft text-ds-blue hover:brightness-95',
  gray:
    'border border-ds-border bg-ds-surface text-ds-text hover:bg-ds-surface-muted',
  destructive: 'bg-ds-red text-white hover:brightness-95',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-xs rounded-md',
  md: 'h-10 gap-2 px-3.5 text-sm rounded-md',
  lg: 'h-11 gap-2 px-5 text-sm rounded-md',
}

const BASE =
  'inline-flex items-center justify-center font-medium transition-[background-color,filter,opacity] disabled:pointer-events-none disabled:opacity-50'

/**
 * 按钮外观配方（SSOT）。
 * 供必须渲染成 `<a>` / `<Link>` 的导航型操作复用，避免为链接另造一套按钮视觉。
 */
export function buttonClassName({
  variant = 'primary',
  size = 'md',
  className,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
} = {}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className)
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
      className={buttonClassName({ variant, size, className })}
      {...props}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      {children}
    </button>
  )
}
