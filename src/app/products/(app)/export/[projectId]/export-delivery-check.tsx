'use client'

import Link from 'next/link'
import {
  AudioLines,
  Captions,
  ChevronRight,
  CircleCheck,
  Film,
  ShieldCheck,
  Timer,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { buttonClassName } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPill, type StatusPillVariant } from '@/components/ui/status-pill'
import { Toast } from '@/components/ui/toast'
import { productCanvasHref } from '@/features/navigation/products-routes'
import { cn } from '@/lib/utils'
import type { ExportReadiness } from './export-readiness-contract'
import {
  buildExportDeliveryCheck,
  type ExportDeliveryCheckModel,
  type ExportDeliveryIssue,
  type ExportDeliveryMetric,
  type ExportDeliveryMetricKey,
} from './export-view-model'

export interface ExportDeliveryCheckProps {
  projectId: string
  laneKeys: string[]
  readiness?: ExportReadiness
  error?: string
}

const METRIC_ICON: Record<ExportDeliveryMetricKey, LucideIcon> = {
  render: Film,
  narration: AudioLines,
  subtitle: Captions,
  qa: ShieldCheck,
}

/** 交付检查：以真实 readiness 替代无图片来源的抽帧占位。 */
export function ExportDeliveryCheck({
  projectId,
  laneKeys,
  readiness,
  error,
}: ExportDeliveryCheckProps) {
  const delivery = readiness
    ? buildExportDeliveryCheck(laneKeys, readiness)
    : undefined

  return (
    <section
      aria-labelledby="export-delivery-check-title"
      className="flex min-w-0 flex-col gap-3 px-4 pb-6 pt-2 sm:px-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="export-delivery-check-title" className="text-sm font-semibold">
            交付检查
          </h2>
          <p className="mt-1 text-xs text-ds-text-muted">
            镜头、媒体与 QA 的实时交付门禁
          </p>
        </div>
        <DeliveryStatus delivery={delivery} failed={!readiness && Boolean(error)} />
      </header>
      {!delivery && !error && <DeliveryCheckSkeleton />}
      {delivery && (
        <DeliveryCheckCard
          delivery={delivery}
          canvasHref={productCanvasHref(projectId)}
        />
      )}
      {error && <Toast variant="error" title="失败" body={error} />}
    </section>
  )
}

function DeliveryStatus({
  delivery,
  failed,
}: {
  delivery?: ExportDeliveryCheckModel
  failed: boolean
}) {
  if (failed) return <StatusPill variant="failed" label="状态读取失败" />
  if (!delivery) return <StatusPill variant="generating" label="读取中" />
  const variant: StatusPillVariant =
    delivery.state === 'ready'
      ? 'rendered'
      : delivery.state === 'degraded'
        ? 'stale'
        : 'pending'
  return <StatusPill variant={variant} label={delivery.statusLabel} />
}

function DeliveryCheckSkeleton() {
  return (
    <Card className="grid gap-px overflow-hidden bg-ds-border p-0 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 bg-ds-surface p-4">
          <Skeleton circle className="size-9 shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      ))}
    </Card>
  )
}

function DeliveryCheckCard({
  delivery,
  canvasHref,
}: {
  delivery: ExportDeliveryCheckModel
  canvasHref: string
}) {
  return (
    <Card className="overflow-hidden p-0">
      <dl className="grid gap-px bg-ds-border sm:grid-cols-2 xl:grid-cols-4">
        {delivery.metrics.map((metric) => (
          <DeliveryMetric key={metric.key} metric={metric} />
        ))}
      </dl>
      {delivery.issues.length > 0 && (
        <div className="border-t border-ds-border p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold text-ds-text">待处理事项</h3>
            <span className="font-mono text-[11px] text-ds-text-muted">
              {delivery.issues.length}
            </span>
          </div>
          <ul className="mt-3 grid max-h-36 gap-2 overflow-y-auto sm:grid-cols-2">
            {delivery.issues.map((issue) => (
              <DeliveryIssue key={issue.key} issue={issue} />
            ))}
          </ul>
        </div>
      )}
      <DeliveryCheckFooter delivery={delivery} canvasHref={canvasHref} />
    </Card>
  )
}

function DeliveryMetric({ metric }: { metric: ExportDeliveryMetric }) {
  const Icon = METRIC_ICON[metric.key]
  return (
    <div className="flex min-w-0 items-start gap-3 bg-ds-surface p-4">
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg',
          metric.state === 'ready' && 'bg-ds-green-soft text-ds-green',
          metric.state === 'warning' && 'bg-ds-amber-soft text-ds-amber',
          metric.state === 'pending' && 'bg-ds-surface-muted text-ds-text-muted',
        )}
      >
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="min-w-0">
        <dt className="text-xs text-ds-text-muted">{metric.label}</dt>
        <dd className="mt-0.5 font-mono text-base font-semibold text-ds-text">
          {metric.value}
        </dd>
        <p className="mt-1 text-[11px] leading-4 text-ds-text-muted">
          {metric.detail}
        </p>
      </div>
    </div>
  )
}

function DeliveryIssue({ issue }: { issue: ExportDeliveryIssue }) {
  const Icon = issue.tone === 'pending' ? Timer : TriangleAlert
  return (
    <li className="flex min-w-0 items-start gap-2 rounded-lg bg-ds-surface-muted px-3 py-2.5">
      <Icon
        aria-hidden
        className={cn(
          'mt-0.5 size-3.5 shrink-0',
          issue.tone === 'blocked' ? 'text-ds-red' : 'text-ds-amber',
        )}
      />
      <span className="text-xs leading-5 text-ds-text">{issue.label}</span>
    </li>
  )
}

function DeliveryCheckFooter({
  delivery,
  canvasHref,
}: {
  delivery: ExportDeliveryCheckModel
  canvasHref: string
}) {
  if (delivery.state === 'ready') {
    return (
      <div className="flex items-center gap-2 border-t border-ds-border bg-ds-green-soft px-4 py-3 text-xs text-ds-green">
        <CircleCheck aria-hidden className="size-4 shrink-0" />
        全部门禁已通过，可从右上角开始导出。
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ds-border px-4 py-3">
      <p className="max-w-2xl text-xs leading-5 text-ds-text-muted">
        {delivery.description}
        {delivery.incompleteNodeCount > 0 &&
          ` 当前还有 ${delivery.incompleteNodeCount} 个工作流节点未完成。`}
        {delivery.state === 'degraded' &&
          ' 可在右上角确认降级范围，或返回画布修复后再完整导出。'}
      </p>
      <Link
        href={canvasHref}
        className={buttonClassName({ variant: 'gray', size: 'sm' })}
      >
        返回画布处理
        <ChevronRight aria-hidden className="size-3.5" />
      </Link>
    </div>
  )
}
