import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined }),
}))
import type { BillingUiProjection } from './projection-contract'
import {
  BillingCanvasUsage,
  BillingDashboardUsage,
  BillingSidebarMeter,
} from './usage-panels'
import { BillingPageView } from './billing-page-view'

const projection: BillingUiProjection = {
  planKey: 'pro',
  cycle: {
    startsAt: '2026-07-28T00:00:00.000Z',
    endsAt: '2026-08-27T00:00:00.000Z',
  },
  usage: {
    percent: 36,
    remainingPercent: 64,
    invocationCount: 128,
  },
  tokenUsage: {
    inputTokens: 123456,
    outputTokens: 65432,
  },
  providerCalls: {
    stepfun: 11,
    mimo: 7,
    gemini: 3,
  },
  lastInvocationAt: '2026-07-28T06:30:00.000Z',
  canRedeem: true,
}

describe('billing usage projections', () => {
  it('renders a readable sidebar meter and compact ring', () => {
    const expanded = renderToStaticMarkup(
      createElement(BillingSidebarMeter, { projection, compact: false }),
    )
    expect(expanded).toContain('Pro')
    expect(expanded).toContain('本周期已用 36%')
    expect(expanded).toContain('href="/products/billing"')

    const compact = renderToStaticMarkup(
      createElement(BillingSidebarMeter, { projection, compact: true }),
    )
    expect(compact).toContain('aria-label="Pro，本周期已用 36%"')
    expect(compact).toContain('svg')
  })

  it('renders a compact canvas projection without internal money', () => {
    const html = renderToStaticMarkup(
      createElement(BillingCanvasUsage, { projection }),
    )
    expect(html).toContain('Pro')
    expect(html).toContain('36%')
    expect(html).not.toContain('CNY')
    expect(html).not.toContain('micros')
  })

  it('renders detailed dashboard usage from the public projection', () => {
    const html = renderToStaticMarkup(
      createElement(BillingDashboardUsage, { projection }),
    )
    expect(html).toContain('本周期用量')
    expect(html).toContain('128')
    expect(html).toContain('64%')
    expect(html).toContain('123,456')
    expect(html).toContain('65,432')
    expect(html).toContain('StepFun')
    expect(html).toContain('Mimo')
    expect(html).toContain('Gemini')
    expect(html).toContain('最近调用')
    expect(html).toContain('2026')
    expect(html).not.toContain('limitCnyMicros')
  })

  it('renders four approved plans, a disabled payment path and redemption entry', () => {
    const html = renderToStaticMarkup(
      createElement(BillingPageView, { projection }),
    )
    for (const plan of ['Free', 'Plus', 'Pro', 'Max']) {
      expect(html).toContain(`>${plan}<`)
    }
    for (const price of ['¥0', '¥29', '¥99', '¥599']) {
      expect(html).toContain(price)
    }
    expect(html).toContain('支付暂未开放')
    expect(html).toContain('兑换码')
    expect(html).not.toContain('limitCnyMicros')
  })
})
