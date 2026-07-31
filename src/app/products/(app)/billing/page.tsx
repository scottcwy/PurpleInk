import { withPageSession } from '@/features/auth/page-session'
import { getBillingProjection } from '@/features/billing'
import { BillingPageView } from '@/features/billing/ui/billing-page-view'
import { PRODUCTS_ROUTES } from '@/features/navigation/products-routes'
import { getAiUsageProjection } from '@/features/usage'

export const dynamic = 'force-dynamic'

export default async function BillingPage() {
  return withPageSession(PRODUCTS_ROUTES.billing, async (session) => {
    const [projection, usageProjection] = await Promise.all([
      getBillingProjection(),
      getAiUsageProjection({
        userId: session.userId,
        view: 'managed-cycle',
        range: 'cycle',
        timeZone: 'UTC',
      }).catch(() => null),
    ])
    return (
      <BillingPageView
        projection={projection}
        usageProjection={usageProjection}
      />
    )
  })
}
