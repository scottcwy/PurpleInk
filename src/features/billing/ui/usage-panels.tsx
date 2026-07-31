'use client'

import { Sparkles } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { ProgressBar } from '@/components/ui/progress-bar'
import { StatusPill } from '@/components/ui/status-pill'
import { UsageTrendChart } from '@/components/ui/usage-trend-chart'
import { PRODUCTS_ROUTES } from '@/features/navigation/products-routes'
import {
  type AiUsageProjectionV1,
  useAiUsageProjection,
} from '@/features/usage/client'
import { cn } from '@/lib/utils'
import {
  clampUsagePercent,
  formatBillingPeriod,
  formatBillingResetDate,
  publicPlanName,
} from './billing-display'
import type { BillingUiProjection } from './projection-contract'
import { useBillingProjection } from './use-billing-projection'

export function BillingSidebarUsage({ compact }: { compact: boolean }) {
  const { projection, unavailable } = useBillingProjection()

  if (projection) {
    return <BillingSidebarMeter compact={compact} projection={projection} />
  }
  if (!unavailable) return null
  return (
    <Link
      href={PRODUCTS_ROUTES.billing}
      className={cn(
        'flex items-center rounded-md border border-ds-border bg-ds-surface text-ds-text-muted',
        compact ? 'size-9 justify-center' : 'h-9 px-2.5 text-[11px]',
      )}
      aria-label="额度信息暂不可用"
    >
      <Sparkles aria-hidden className="size-4 shrink-0" />
      {!compact && <span className="ml-2">额度暂不可用</span>}
    </Link>
  )
}

export function BillingSidebarMeter({
  projection,
  compact,
}: {
  projection: BillingUiProjection
  compact: boolean
}) {
  const percent = clampUsagePercent(projection.usage.percent)
  const planName = publicPlanName(projection.planKey)
  const label = `${planName}，本周期已用 ${percent}%`

  if (compact) {
    return (
      <Link
        href={PRODUCTS_ROUTES.billing}
        aria-label={label}
        title={label}
        className="relative flex size-9 items-center justify-center rounded-full text-ds-blue transition-colors duration-fast ease-standard hover:bg-ds-surface-muted"
      >
        <UsageRing percent={percent} />
        <span className="absolute text-[9px] font-semibold">{planName.slice(0, 1)}</span>
      </Link>
    )
  }

  return (
    <Link
      href={PRODUCTS_ROUTES.billing}
      aria-label={label}
      className="block rounded-md border border-ds-border bg-ds-surface p-2.5 transition-colors duration-fast ease-standard hover:bg-ds-surface-muted"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{planName}</span>
        <span className="font-mono text-[10px] text-ds-text-muted">{percent}%</span>
      </div>
      <ProgressBar value={percent} className="w-full gap-0 [&>div:first-child]:hidden" />
      <p className="mt-1.5 text-[10px] text-ds-text-muted">
        剩余 {projection.usage.remainingPercent}% · {formatBillingResetDate(projection.cycle.endsAt)} 重置
      </p>
    </Link>
  )
}

export function BillingCanvasUsage({
  projection,
}: {
  projection: BillingUiProjection
}) {
  const percent = clampUsagePercent(projection.usage.percent)
  return (
    <Link
      href={PRODUCTS_ROUTES.billing}
      className="inline-flex h-8 items-center gap-2 rounded-md border border-ds-border bg-ds-surface px-2.5 text-xs text-ds-text hover:bg-ds-surface-muted"
      aria-label={`${publicPlanName(projection.planKey)}，额度已用 ${percent}%`}
    >
      <Sparkles aria-hidden className="size-3.5 text-ds-blue" />
      <span className="font-semibold">{publicPlanName(projection.planKey)}</span>
      <span className="font-mono text-ds-text-muted">{percent}%</span>
    </Link>
  )
}

export function BillingDashboardUsage({
  projection,
  usageProjection,
}: {
  projection: BillingUiProjection
  usageProjection: AiUsageProjectionV1 | null
}) {
  const usageState = useAiUsageProjection(
    usageProjection,
    'managed-cycle',
    'cycle',
  )
  const percent = clampUsagePercent(projection.usage.percent)
  const numberFormatter = new Intl.NumberFormat('en-US')
  const timeZone = usageState.projection?.timeZone ?? 'UTC'
  const lastInvocation = projection.lastInvocationAt
    ? new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
      }).format(new Date(projection.lastInvocationAt))
    : '暂无调用'
  return (
    <Card className="grid min-w-0 gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">本周期用量</h2>
          <StatusPill
            variant={percent >= 90 ? 'stale' : 'cached'}
            icon={Sparkles}
            label={publicPlanName(projection.planKey)}
          />
        </div>
        <p className="mt-1 text-xs text-ds-text-muted">
          平台托管模型的脱敏用量汇总；自定义端点不计入。
        </p>
        <ProgressBar
          value={percent}
          label={`已用 ${percent}%`}
          className="mt-5 w-full"
        />
        <div className="mt-6 border-t border-ds-border pt-4">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">周期累计额度</h3>
              <p className="text-xs text-ds-text-muted">
                仅按已结算平台托管成本换算百分比，不包含自己的 API。
              </p>
            </div>
            <span className="text-xs text-ds-text-muted">
              {usageState.status === 'loading' ? '按本地时区刷新中' : '0–100%'}
            </span>
          </div>
          {usageState.projection ? (
            <UsageTrendChart
              variant="cumulative-line"
              series={usageState.projection.series}
            />
          ) : (
            <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-ds-border px-4 text-center text-xs text-ds-text-muted">
              {usageState.status === 'error'
                ? '真实额度趋势暂不可用；未使用演示数据回退。'
                : '正在读取真实额度趋势'}
            </div>
          )}
          {usageState.projection && (
            <p className="mt-2 text-xs text-ds-text-muted">
              托管历史已包含；BYOK 历史缺失不影响本图。
            </p>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-ds-border bg-ds-border">
        <UsageDatum label="剩余额度" value={`${projection.usage.remainingPercent}%`} />
        <UsageDatum label="已结算调用" value={numberFormatter.format(projection.usage.invocationCount)} />
        <UsageDatum label="输入 Token" value={numberFormatter.format(projection.tokenUsage.inputTokens)} />
        <UsageDatum label="输出 Token" value={numberFormatter.format(projection.tokenUsage.outputTokens)} />
        <UsageDatum
          label="供应商调用"
          value={[
            `StepFun ${numberFormatter.format(projection.providerCalls.stepfun)}`,
            `Mimo ${numberFormatter.format(projection.providerCalls.mimo)}`,
            `Gemini ${numberFormatter.format(projection.providerCalls.gemini)}`,
            `OpenAI ${numberFormatter.format(projection.providerCalls.openai)}`,
            `Anthropic ${numberFormatter.format(projection.providerCalls.anthropic)}`,
          ].join(' · ')}
          className="col-span-2"
        />
        <UsageDatum label="最近调用" value={lastInvocation} className="col-span-2" />
        <UsageDatum
          label="周期"
          value={formatBillingPeriod(projection.cycle)}
          className="col-span-2"
        />
      </dl>
    </Card>
  )
}

function UsageDatum({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={cn('bg-ds-surface-muted p-3', className)}>
      <dt className="text-[10px] text-ds-text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-sm font-semibold text-ds-text">{value}</dd>
    </div>
  )
}

function UsageRing({ percent }: { percent: number }) {
  const radius = 14
  const circumference = 2 * Math.PI * radius
  return (
    <svg aria-hidden className="size-9 -rotate-90" viewBox="0 0 36 36">
      <circle
        cx="18"
        cy="18"
        r={radius}
        fill="none"
        stroke="var(--ds-border)"
        strokeWidth="3"
      />
      <circle
        cx="18"
        cy="18"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="3"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - percent / 100)}
      />
    </svg>
  )
}
