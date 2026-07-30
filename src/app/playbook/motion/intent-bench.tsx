'use client'

import { CircleAlert, CircleCheck } from 'lucide-react'
import { MOTION_INTENTS, type MotionIntent } from './motion-intents'
import { SPECIMENS } from './intent-specimens'
import { cn } from '@/lib/utils'

const CATEGORY_LABEL: Record<MotionIntent['category'], string> = {
  spatial: 'spatial · 可 overshoot',
  effects: 'effects · 禁 spring',
  mixed: 'spatial + effects',
  none: '无弹性',
}

/** 状态徽标同时给出图标与文本，不只靠颜色表达（design-quality-pitfalls.md §1.5）。 */
function StatusBadge({ status }: { status: MotionIntent['status'] }) {
  const unified = status === 'unified'
  const Icon = unified ? CircleCheck : CircleAlert
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
        unified
          ? 'border-ds-border bg-ds-green-soft text-ds-green'
          : 'border-ds-border bg-ds-amber-soft text-ds-amber',
      )}
    >
      <Icon className="size-3" aria-hidden />
      {unified ? '已统一' : '待迁移'}
    </span>
  )
}

function IntentCard({ intent }: { intent: MotionIntent }) {
  const Specimen = SPECIMENS[intent.id]
  return (
    <article className="border-ds-border bg-ds-surface rounded-lg border p-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            <span className="text-ds-text-muted font-mono text-[11px]">
              §3.{intent.no}
            </span>{' '}
            {intent.title}
          </h3>
          <p className="text-ds-text-muted mt-0.5 font-mono text-[10px]">
            {CATEGORY_LABEL[intent.category]}
          </p>
        </div>
        <StatusBadge status={intent.status} />
      </header>

      <div className="mt-3">
        {Specimen ? (
          <Specimen />
        ) : (
          <p className="border-ds-border text-ds-text-muted rounded-md border border-dashed p-3 text-[11px]">
            标本未登记。规范 §3 新增意图必须同批在 intent-specimens.tsx 落标本。
          </p>
        )}
      </div>

      <dl className="mt-3 space-y-1.5 text-[11px] leading-5">
        <div>
          <dt className="text-ds-text-muted font-mono text-[10px]">目标参数</dt>
          <dd className="font-mono">{intent.params}</dd>
        </div>
        {intent.current && (
          <div>
            <dt className="text-ds-text-muted font-mono text-[10px]">生产现状</dt>
            <dd className="text-ds-amber">{intent.current}</dd>
          </div>
        )}
      </dl>
    </article>
  )
}

export function IntentBench() {
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {MOTION_INTENTS.map((intent) => (
        <IntentCard key={intent.id} intent={intent} />
      ))}
    </div>
  )
}
