'use client'

import { CircleX, RefreshCw, SkipForward, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { Button, buttonClassName } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import {
  formatBillingPeriod,
  getQuotaUpgradeDirection,
  publicPlanName,
} from '@/features/billing/ui/billing-display'
import type { BillingUiProjection } from '@/features/billing/ui/projection-contract'
import { useBillingProjection } from '@/features/billing/ui/use-billing-projection'
import { PRODUCTS_ROUTES } from '@/features/navigation/products-routes'

export interface StageErrorDialogProps {
  open: boolean
  /** 失败阶段（如 INGEST / DIRECT）。 */
  stage: string
  /** 服务端记录的真实失败原因（canvas_nodes.data.directorError.message）。 */
  message: string
  errorCode?: string
  billingProjection?: BillingUiProjection
  onClose: () => void
  onRetry: () => void
  retrying?: boolean
  retryable?: boolean
  /** 节点类型可跳过时提供：弹出跳过二次确认（routing.md 跳过合同）；不可跳过类型不渲染按钮。 */
  onSkip?: () => void
}

/**
 * 阶段失败的持久化错误弹窗（业务组合，复用已登记的 `Dialog` 原语）。
 * 内容取自 DB 的 `directorError`（刷新不丢），非自动消失；仅在真实失败时呈现。
 */
export function StageErrorDialog({
  open,
  stage,
  message,
  errorCode,
  billingProjection,
  onClose,
  onRetry,
  retrying,
  retryable = true,
  onSkip,
}: StageErrorDialogProps) {
  const quotaExhausted =
    errorCode === 'quota_exhausted' || errorCode === 'QUOTA_EXHAUSTED'
  const {
    projection: fetchedProjection,
    unavailable,
  } = useBillingProjection(open && quotaExhausted && !billingProjection)
  const projection = billingProjection ?? fetchedProjection
  const upgrade = projection ? getQuotaUpgradeDirection(projection.planKey) : undefined
  const quotaDescription = projection?.planKey === 'max'
    ? `Max 已是最高额度，请等待下一周期重置（${formatBillingPeriod(projection.cycle)}）。`
    : projection
      ? `${publicPlanName(projection.planKey)} 本周期额度已用完，可升级套餐继续使用平台托管模型。`
      : unavailable
        ? '本周期额度已用完。额度详情暂不可用，请前往套餐与额度页查看。'
        : '本周期额度已用完，正在读取套餐信息。'
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {quotaExhausted
            ? <Sparkles className="size-5 shrink-0 text-ds-blue" />
            : <CircleX className="size-5 shrink-0 text-ds-red" />}
          {quotaExhausted
            ? '本周期 AI 额度已用完'
            : stage ? `${stage} 阶段失败` : '阶段执行失败'}
        </span>
      }
      description={quotaExhausted
        ? '平台托管模型将在额度恢复或升级套餐后继续执行。'
        : 'AI 执行该阶段时报错，以下为服务端记录的失败原因。'}
      actions={
        <>
          <Button variant="gray" onClick={onClose}>
            关闭
          </Button>
          {!quotaExhausted && onSkip && (
            <Button variant="gray" icon={SkipForward} onClick={onSkip} disabled={retrying}>
              跳过此环节
            </Button>
          )}
          {!quotaExhausted && retryable && (
            <Button variant="tinted" icon={RefreshCw} onClick={onRetry} disabled={retrying}>
              重试
            </Button>
          )}
          {quotaExhausted && projection?.planKey !== 'max' && (
            <Link
              href={PRODUCTS_ROUTES.billing}
              className={buttonClassName({ variant: 'tinted' })}
              onClick={onClose}
            >
              {upgrade?.actionLabel ?? '查看套餐与额度'}
            </Link>
          )}
        </>
      }
    >
      {quotaExhausted ? (
        <div className="rounded-md border border-ds-border bg-ds-blue-soft p-3 text-sm leading-relaxed text-ds-text">
          {quotaDescription}
        </div>
      ) : (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed text-ds-red">
          {message || '（无错误详情）'}
        </pre>
      )}
    </Dialog>
  )
}
