import type { PlanKey } from '../domain'

export interface PublicPlanCard {
  key: PlanKey
  name: string
  price: number
  quotaLabel: string
  summary: string
  features: readonly string[]
}

export const PUBLIC_PLAN_CARDS: readonly PublicPlanCard[] = [
  {
    key: 'free',
    name: 'Free',
    price: 0,
    quotaLabel: '基础额度',
    summary: '适合体验完整创作流程。',
    features: ['基础平台 AI 额度', 'StepFun 与 MiMo 托管模型'],
  },
  {
    key: 'plus',
    name: 'Plus',
    price: 29,
    quotaLabel: '5x 额度',
    summary: '适合稳定进行个人项目。',
    features: ['5x 平台 AI 额度', '解锁 Gemini 托管模型'],
  },
  {
    key: 'pro',
    name: 'Pro',
    price: 99,
    quotaLabel: '20x 额度',
    summary: '适合高频制作与多项目推进。',
    features: ['20x 平台 AI 额度', '包含 Plus 的托管模型'],
  },
  {
    key: 'max',
    name: 'Max',
    price: 599,
    quotaLabel: '200x 额度',
    summary: '只提升平台 AI 额度，不附加专属能力。',
    features: ['200x 平台 AI 额度'],
  },
]

export function clampUsagePercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function formatBillingPeriod(period: {
  startsAt: string
  endsAt: string
}): string {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
  return `${formatter.format(new Date(period.startsAt))} – ${formatter.format(new Date(period.endsAt))}`
}

export function formatBillingResetDate(endsAt: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(endsAt))
}

export function publicPlanName(planKey: PlanKey): string {
  return PUBLIC_PLAN_CARDS.find(({ key }) => key === planKey)?.name ?? planKey
}

export function getQuotaUpgradeDirection(planKey: PlanKey): {
  nextPlan: Exclude<PlanKey, 'free'>
  actionLabel: string
} | null {
  const nextPlanByTier = {
    free: 'plus',
    plus: 'pro',
    pro: 'max',
  } as const
  if (planKey === 'max') return null
  const nextPlan = nextPlanByTier[planKey]
  return {
    nextPlan,
    actionLabel: `升级至 ${publicPlanName(nextPlan)}`,
  }
}
