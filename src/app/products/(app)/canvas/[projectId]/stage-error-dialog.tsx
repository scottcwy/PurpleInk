'use client'

import { CircleAlert, Copy, RefreshCw, Settings, SkipForward } from 'lucide-react'
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
import {
  workflowFaultDisplay,
  workflowRecoveryActions,
  type WorkflowFaultDisplayInput,
} from '@/features/canvas/workflow-fault-display'
import {
  PRODUCTS_ROUTES,
  productSettingsHref,
} from '@/features/navigation/products-routes'

export interface StageErrorDialogProps extends WorkflowFaultDisplayInput {
  open: boolean
  projectId?: string
  errorCode?: string
  billingProjection?: BillingUiProjection
  retryable?: boolean
  onClose: () => void
  onRetry: () => void
  onCancelWait?: () => void
  retrying?: boolean
  onSkip?: () => void
}

export function StageErrorDialog(props: StageErrorDialogProps) {
  const errorCode = props.code ?? props.errorCode
  const quotaExhausted =
    errorCode === 'quota_exhausted' || errorCode === 'QUOTA_EXHAUSTED'
  const { projection: fetchedProjection, unavailable } = useBillingProjection(
    props.open && quotaExhausted && !props.billingProjection
  )
  const projection = props.billingProjection ?? fetchedProjection
  const upgrade = projection ? getQuotaUpgradeDirection(projection.planKey) : undefined
  const quotaDescription = projection?.planKey === 'max'
    ? `Max 已是最高额度，请等待下一周期重置（${formatBillingPeriod(projection.cycle)}）。`
    : projection
      ? `${publicPlanName(projection.planKey)} 本周期额度已用完，可升级套餐继续使用平台托管模型。`
      : unavailable
        ? '本周期额度已用完。额度详情暂不可用，请前往套餐与额度页查看。'
        : '本周期额度已用完，正在读取套餐信息。'
  const display = workflowFaultDisplay({
    ...props,
    code: errorCode,
    ...(quotaExhausted
      ? {
          title: '本周期 AI 额度已用完',
          message: quotaDescription,
          origin: 'user',
          recovery: 'upgrade_plan',
        }
      : {}),
  })
  const recoveryActions = workflowRecoveryActions(display.recovery)
  const settingsHref = productSettingsHref(props.projectId)
  const technicalDetails = [
    ['供应商', props.provider?.label],
    ['HTTP 状态码', props.provider?.httpStatus],
    ['发生时间', formatOccurredAt(props.occurredAt)],
    ['阶段', props.stage],
    ['参考号', props.referenceId],
  ].filter((entry) => entry[1] !== undefined && entry[1] !== '')

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title={
        <span className="flex items-center gap-2">
          <CircleAlert className="size-5 shrink-0 text-ds-text-muted" />
          {display.title}
        </span>
      }
      description="以下说明来自统一工作流错误投影，不包含供应商原始响应、Prompt 或凭据。"
      actions={
        <>
          <Button variant="gray" onClick={props.onClose}>关闭</Button>
          {props.onSkip && !quotaExhausted && display.recovery !== 'auto_wait' && (
            <Button
              variant="gray"
              icon={SkipForward}
              onClick={props.onSkip}
              disabled={props.retrying}
            >
              跳过此环节
            </Button>
          )}
          {recoveryActions.includes('cancel_wait') && props.onCancelWait && (
            <Button variant="gray" onClick={props.onCancelWait} disabled={props.retrying}>
              取消等待
            </Button>
          )}
          <RecoveryAction
            recovery={display.recovery}
            settingsHref={settingsHref}
            referenceId={props.referenceId}
            retryable={props.retryable !== false}
            retrying={props.retrying}
            onClose={props.onClose}
            onRetry={props.onRetry}
            upgradeLabel={upgrade?.actionLabel}
            suppressUpgrade={projection?.planKey === 'max'}
          />
        </>
      }
    >
      <div className="space-y-4">
        <span className="inline-flex rounded-full border border-ds-border px-2.5 py-1 text-xs font-medium text-ds-text">
          {display.responsibility}
        </span>
        <Explanation label="发生了什么" text={display.happened} />
        <Explanation label="系统正在做什么" text={display.systemAction} />
        <Explanation label="你可以做什么" text={display.userAction} />
        {technicalDetails.length > 0 && (
          <details className="rounded-md border border-ds-border bg-ds-surface">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ds-text">
              技术详情
            </summary>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 border-t border-ds-border px-3 py-3 text-xs">
              {technicalDetails.map(([label, value]) => (
                <div key={String(label)} className="contents">
                  <dt className="text-ds-text-muted">{label}</dt>
                  <dd className="min-w-0 break-all text-ds-text">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
    </Dialog>
  )
}

function Explanation({ label, text }: { label: string; text: string }) {
  return (
    <section>
      <h3 className="text-xs font-medium text-ds-text-muted">{label}</h3>
      <p className="mt-1 text-sm leading-relaxed text-ds-text">{text}</p>
    </section>
  )
}

function RecoveryAction(props: {
  recovery: ReturnType<typeof workflowFaultDisplay>['recovery']
  settingsHref: string
  referenceId?: string
  retryable: boolean
  retrying?: boolean
  onClose: () => void
  onRetry: () => void
  upgradeLabel?: string
  suppressUpgrade: boolean
}) {
  const actions = workflowRecoveryActions(props.recovery)
  if (actions.includes('fix_settings')) {
    return (
      <Link
        href={props.settingsHref}
        className={buttonClassName({ variant: 'tinted' })}
        onClick={props.onClose}
      >
        <Settings className="size-4" />
        前往模型设置
      </Link>
    )
  }
  if (actions.includes('upgrade_plan')) {
    if (props.suppressUpgrade) return null
    return (
      <Link
        href={PRODUCTS_ROUTES.billing}
        className={buttonClassName({ variant: 'tinted' })}
        onClick={props.onClose}
      >
        {props.upgradeLabel ?? '查看套餐与额度'}
      </Link>
    )
  }
  if (actions.includes('contact_support') && props.referenceId) {
    return (
      <Button
        variant="tinted"
        icon={Copy}
        onClick={() => navigator.clipboard.writeText(props.referenceId!)}
      >
        复制参考号
      </Button>
    )
  }
  if (actions.includes('edit_input')) {
    return <Button variant="tinted" onClick={props.onClose}>返回原稿或素材</Button>
  }
  if (actions.includes('switch_provider')) {
    return (
      <Link
        href={props.settingsHref}
        className={buttonClassName({ variant: 'tinted' })}
        onClick={props.onClose}
      >
        切换模型
      </Link>
    )
  }
  if (actions.includes('confirm_degraded_export')) {
    return (
      <Button
        variant="tinted"
        onClick={props.onRetry}
        disabled={props.retrying}
      >
        确认降级导出
      </Button>
    )
  }
  return actions.includes('manual_retry') && props.retryable ? (
    <Button
      variant="tinted"
      icon={RefreshCw}
      onClick={props.onRetry}
      disabled={props.retrying}
    >
      重新执行
    </Button>
  ) : null
}

function formatOccurredAt(value: string | undefined): string | undefined {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN') : undefined
}
