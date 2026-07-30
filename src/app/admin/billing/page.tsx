import { requireAdminSession } from '@/features/auth/page-session'
import { BillingClient } from './billing-client'

/** 订阅计费：server page 自己包守卫（layout 守卫不传播），数据走 /api/admin/billing。 */
export const dynamic = 'force-dynamic'

export default async function AdminBillingPage() {
  await requireAdminSession('/admin/billing')
  return <BillingClient />
}
