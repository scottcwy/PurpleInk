import type { ComponentType, ReactNode } from 'react'
import type { HTMLMotionProps } from 'motion/react'
import { LoaderCircle } from 'lucide-react'
import { ControlPressButton } from '@/components/ui/control-motion'
import { cn } from '@/lib/utils'

/**
 * 设计系统 4 变体（见 design-system-inventory §4.3）：
 * - primary: 主 CTA（扁平墨色实心，暗色反转为近白；零渐变零投影）— 新建项目、导出
 * - tinted: 次主操作（blue-soft 底 + blue 字）— 执行此阶段、生成分镜代码
 * - gray: 取消 / 次级
 * - destructive: 高代价操作（red）— 重渲此镜、删除
 */
export type ButtonVariant = 'primary' | 'tinted' | 'gray' | 'destructive'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ComponentType<{ className?: string }>
  /** opt-in 加载态：强制 disabled + aria-busy，图标槽位换成 loader-circle 旋转；文案切换由调用方 children 控制。 */
  loading?: boolean
  children?: ReactNode
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'ds-primary-button active:brightness-95',
  tinted:
    'bg-ds-blue-soft text-ds-blue hover:bg-[color-mix(in_srgb,var(--ds-blue)_16%,transparent)] active:brightness-95',
  gray:
    'border border-ds-border bg-ds-surface text-ds-text hover:bg-ds-surface-muted active:brightness-95',
  destructive:
    'bg-ds-red text-white hover:brightness-95 active:brightness-90',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-[13px] rounded-md',
  md: 'h-9 gap-2 px-3.5 text-sm rounded-md',
  lg: 'h-10 gap-2 px-4 text-sm rounded-md',
}

const BASE =
  'inline-flex items-center justify-center font-medium transition-[background-color,box-shadow,filter,opacity,transform] duration-fast active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring disabled:pointer-events-none disabled:opacity-45'

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
  loading = false,
  disabled,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <ControlPressButton
      className={buttonClassName({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <LoaderCircle aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
      ) : (
        Icon && <Icon className="h-4 w-4 shrink-0" />
      )}
      {children}
    </ControlPressButton>
  )
}
