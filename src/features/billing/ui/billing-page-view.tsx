import { CircleCheck, Info, ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StatusPill } from '@/components/ui/status-pill'
import { TopBar } from '@/components/ui/top-bar'
import type { AiUsageProjectionV1 } from '@/features/usage/client'
import { cn } from '@/lib/utils'
import {
  formatBillingPeriod,
  PUBLIC_PLAN_CARDS,
  publicPlanName,
  type PublicPlanCard,
} from './billing-display'
import type { BillingUiProjection } from './projection-contract'
import { RedemptionForm } from './redemption-form'
import { BillingDashboardUsage } from './usage-panels'

export function BillingPageView({
  projection,
  usageProjection,
}: {
  projection: BillingUiProjection
  usageProjection: AiUsageProjectionV1 | null
}) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto text-ds-text">
      <TopBar
        title="会员与额度"
        meta="Workspace 级平台 AI 用量"
        className="pl-12 sm:px-7"
      />
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-4 py-5 sm:px-7 sm:py-7">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {publicPlanName(projection.planKey)}
              </h1>
              <StatusPill variant="rendered" icon={ShieldCheck} label="当前方案" />
            </div>
            <p className="mt-1.5 text-sm text-ds-text-muted">
              当前周期 {formatBillingPeriod(projection.cycle)}
            </p>
          </div>
          <p className="max-w-md text-xs leading-5 text-ds-text-muted">
            平台托管额度按 30 天滚动周期结算；自定义 OpenAI-compatible
            端点使用自己的凭据，不消耗这里的额度。
          </p>
        </header>

        <BillingDashboardUsage
          projection={projection}
          usageProjection={usageProjection}
        />

        <section aria-labelledby="billing-plans-title">
          <div className="mb-3">
            <h2 id="billing-plans-title" className="text-lg font-semibold">选择方案</h2>
            <p className="mt-1 text-xs text-ds-text-muted">
              支付通道尚未开放；目前可通过一次性兑换码更新方案。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {PUBLIC_PLAN_CARDS.map((plan) => (
              <PlanCard
                key={plan.key}
                plan={plan}
                current={plan.key === projection.planKey}
              />
            ))}
          </div>
        </section>

        <Card className="grid gap-5 p-5 md:grid-cols-[minmax(0,0.7fr)_minmax(360px,1fr)]">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles aria-hidden className="size-5 text-ds-blue" />
              <h2 className="text-lg font-semibold">兑换码</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-ds-text-muted">
              同级方案会延长当前有效期，高级方案立即升级并开启新周期。低级方案不会覆盖尚未到期的高级会员。
            </p>
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-ds-text-muted">
              <Info aria-hidden className="size-3.5" />
              兑换码仅校验一次，成功后无法转移到其他工作区。
            </p>
          </div>
          <RedemptionForm canRedeem={projection.canRedeem} />
        </Card>
      </div>
    </main>
  )
}

function PlanCard({
  plan,
  current,
}: {
  plan: PublicPlanCard
  current: boolean
}) {
  return (
    <Card
      className={cn(
        'flex min-h-64 flex-col p-4',
        current && 'border-ds-blue shadow-[0_0_0_1px_var(--ds-blue)]',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{plan.name}</h3>
          <p className="mt-1 text-xs text-ds-text-muted">{plan.summary}</p>
        </div>
        {current && <StatusPill variant="cached" label="当前" />}
      </div>
      <p className="mt-5">
        <strong className="font-mono text-3xl">¥{plan.price}</strong>
        <span className="ml-1 text-xs text-ds-text-muted">/ 30 天</span>
      </p>
      <p className="mt-1 text-xs font-semibold text-ds-blue">{plan.quotaLabel}</p>
      <ul className="mt-4 flex-1 space-y-2">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-2 text-xs leading-5 text-ds-text-muted">
            <CircleCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ds-green" />
            {feature}
          </li>
        ))}
      </ul>
      <Button type="button" variant={current ? 'tinted' : 'gray'} disabled className="mt-4 w-full">
        {current ? '当前方案' : '支付暂未开放'}
      </Button>
    </Card>
  )
}
