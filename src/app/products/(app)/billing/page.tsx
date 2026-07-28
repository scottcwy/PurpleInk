import { withPageSession } from '@/features/auth/page-session'
import { getBillingProjection } from '@/features/billing'
import { BillingPageView } from '@/features/billing/ui/billing-page-view'
import type { BillingUiProjection } from '@/features/billing/ui/projection-contract'
import { PRODUCTS_ROUTES } from '@/features/navigation/products-routes'

export const dynamic = 'force-dynamic'

export default async function BillingPage() {
  return withPageSession(PRODUCTS_ROUTES.billing, async () => {
    const projection: BillingUiProjection = await getBillingProjection()
    return <BillingPageView projection={projection} />
  })
}
