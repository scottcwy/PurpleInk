'use client'

import { passwordSchema } from '@/features/auth/credential-policy'
import { cn } from '@/lib/utils'

type StrengthLevel = 'weak' | 'medium' | 'strong'

/** 强档在「可注册」之上再要求长度与字符面：≥12 位且含大小写或特殊字符。 */
const STRONG_MIN_LENGTH = 12

interface StrengthDescriptor {
  label: string
  barClassName: string
  widthClassName: string
}

const STRENGTH: Record<StrengthLevel, StrengthDescriptor> = {
  weak: { label: '弱：还不满足注册要求', barClassName: 'bg-ds-red', widthClassName: 'w-1/3' },
  medium: { label: '中：已满足注册要求', barClassName: 'bg-ds-amber', widthClassName: 'w-2/3' },
  strong: { label: '强', barClassName: 'bg-ds-green', widthClassName: 'w-full' },
}

/**
 * 档位与「可注册」规则同源：中档 = `passwordSchema` 通过，即可提交；
 * 弱档 = 不满足最低规则；强档只是锦上添花，不是注册门槛。
 */
export function evaluatePasswordStrength(password: string): StrengthLevel {
  if (!passwordSchema.safeParse(password).success) return 'weak'
  const spread =
    (/[a-z]/.test(password) && /[A-Z]/.test(password)) || /[^a-zA-Z0-9]/.test(password)
  return password.length >= STRONG_MIN_LENGTH && spread ? 'strong' : 'medium'
}

/**
 * 密码强度指示条。
 *
 * 等级同时用色条与文字标签表达（AGENTS.md §6：状态不能只靠颜色）；
 * `aria-live="polite"` 让读屏用户在输入过程中也能感知等级变化。
 * 宽度变化是 spatial，走 CSS transition 的 `base` + `standard`（规范 §2、§3）。
 */
export function PasswordStrengthMeter({
  password,
  className,
}: {
  password: string
  className?: string
}) {
  if (!password) return null
  const level = evaluatePasswordStrength(password)
  const { label, barClassName, widthClassName } = STRENGTH[level]
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="h-1 w-full overflow-hidden rounded-full bg-ds-surface-muted">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-base ease-standard',
            barClassName,
            widthClassName,
          )}
        />
      </div>
      <p aria-live="polite" className="text-xs text-ds-text-muted">
        密码强度：{label}
      </p>
    </div>
  )
}
