import type { InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

export interface VerificationCodeFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string
  /** 点击「获取验证码」。父级负责调用签发端点与处理失败。 */
  onRequestCode: () => void
  /** 冷却剩余秒数；> 0 时按钮禁用并显示倒计时。 */
  cooldownSeconds?: number
  requesting?: boolean
  /** 已发送过一次后按钮文案改为「重新发送」。 */
  sent?: boolean
}

/**
 * 邮件验证码输入 + 重发按钮（SSOT）。
 *
 * 纯呈现：不发请求、不自己计时。倒计时由父级驱动并以 `cooldownSeconds` 传入，
 * 这样「冷却」与服务端速率限制（`auth_throttle`）保持同一份真值，不会出现
 * 按钮可点但服务端回 429 的错位。
 *
 * 无障碍：倒计时同时给出文本（不只靠禁用态的视觉变化）；`aria-live="polite"`
 * 让读屏用户能感知剩余时间（AGENTS.md §6：状态不能只靠颜色表达）。
 */
export function VerificationCodeField({
  label,
  onRequestCode,
  cooldownSeconds = 0,
  requesting = false,
  sent = false,
  className,
  disabled,
  ...props
}: VerificationCodeFieldProps) {
  const cooling = cooldownSeconds > 0
  return (
    <div className={cn('flex w-full flex-col gap-[7px]', className)}>
      {label && <span className="text-[13px] font-medium text-ds-text">{label}</span>}
      <div className="flex items-start gap-2">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={disabled}
          className="h-10 min-w-0 flex-1 rounded-md border border-ds-border bg-ds-surface px-3 py-[9px] font-mono text-sm tracking-[0.3em] text-ds-text placeholder:tracking-normal placeholder:font-sans placeholder:text-ds-text-muted focus:border-ds-blue focus:outline-none disabled:opacity-50"
          {...props}
        />
        <Button
          type="button"
          variant="gray"
          onClick={onRequestCode}
          disabled={disabled || requesting || cooling}
          className="w-[116px] shrink-0"
        >
          {requesting ? '发送中' : cooling ? `${cooldownSeconds} 秒` : sent ? '重新发送' : '获取验证码'}
        </Button>
      </div>
      <span aria-live="polite" className="min-h-4 text-xs text-ds-text-muted">
        {cooling
          ? `验证码已发送，${cooldownSeconds} 秒后可重新发送`
          : sent
            ? '未收到？可重新发送，验证码 10 分钟内有效'
            : '验证码将发送到上方邮箱，10 分钟内有效'}
      </span>
    </div>
  )
}
