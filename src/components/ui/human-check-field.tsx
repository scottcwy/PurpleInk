import type { InputHTMLAttributes } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from './icon-button'

export interface HumanCheckFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string
  /** 题面文本，如 `17 + 8`。服务端下发，客户端不生成。 */
  question: string
  /** 服务端渲染好的 SVG 字符串；为空时只呈现文本题面。 */
  svg?: string
  onRefresh: () => void
  refreshing?: boolean
  /** 取题失败时置真：底部提示切为红色重试引导（文本+颜色双通道）。 */
  failed?: boolean
}

/**
 * 算术人机验证字段（SSOT）。
 *
 * 纯呈现：题目与 SVG 都由服务端下发（`GET /api/auth/human-check`），本组件不
 * 生成题目、不校验答案——答案只有服务端持有的派生密钥能验。
 *
 * 无障碍：SVG 自带 `role="img"` + `aria-label`，同时把题面以文本形式渲染出来，
 * 因此读屏与关图场景都能作答，验证码不是唯一信息通道（AGENTS.md §6）。
 *
 * `dangerouslySetInnerHTML` 在这里是安全的：内容来自本站同源端点，由
 * `renderChallengeSvg()` 以转义后的数字与运算符拼装，不含用户输入。
 */
export function HumanCheckField({
  label,
  question,
  svg,
  onRefresh,
  refreshing = false,
  failed = false,
  className,
  disabled,
  ...props
}: HumanCheckFieldProps) {
  return (
    <div className={cn('flex w-full flex-col gap-[7px]', className)}>
      {label && <span className="text-[13px] font-medium text-ds-text">{label}</span>}
      <div className="flex items-center gap-2">
        {svg ? (
          <span
            className="flex h-10 w-[132px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-ds-border bg-ds-surface-muted"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <span className="flex h-10 w-[132px] shrink-0 items-center justify-center rounded-md border border-ds-border bg-ds-surface-muted font-mono text-base text-ds-text">
            {question || '…'}
          </span>
        )}
        <IconButton
          type="button"
          icon={refreshing ? SpinningRefreshIcon : RefreshCw}
          aria-label="换一道验证题"
          title="换一道验证题"
          onClick={onRefresh}
          disabled={disabled || refreshing}
        />
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          aria-label={question ? `请计算 ${question} 的结果` : '人机验证答案'}
          className="h-10 min-w-0 flex-1 rounded-md border border-ds-border bg-ds-surface px-3 py-[9px] text-sm text-ds-text placeholder:text-ds-text-muted focus:border-ds-blue focus:outline-none disabled:opacity-50"
          {...props}
        />
      </div>
      {/* 三态提示：失败 > 加载中 > 题面。失败用文本+红色双通道，状态不只靠颜色。 */}
      <span className={cn('text-xs', failed ? 'text-ds-red' : 'text-ds-text-muted')}>
        {failed
          ? '验证题获取失败，点右侧按钮重试'
          : question
            ? `请计算：${question}`
            : '正在获取验证题'}
      </span>
    </div>
  )
}

/** IconButton 固定图标类名为 16px，refreshing 的旋转只能以变体图标叠加。 */
function SpinningRefreshIcon({ className }: { className?: string }) {
  return <RefreshCw className={cn('animate-spin', className)} />
}
