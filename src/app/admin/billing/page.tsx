import { getAdminBilling } from '@/features/admin'
import { AdminBillingPanel } from '@/features/admin/ui/admin-billing-panel'
import { AdminPageFrame } from '@/features/admin/ui/admin-page-frame'
import { requireAdminSession } from '@/features/auth/page-session'

export const dynamic = 'force-dynamic'

export default async function AdminBillingPage() {
  await requireAdminSession('/admin/billing')
  const snapshot = await getAdminBilling()
  return (
    <AdminPageFrame
      title="计费管理"
      description="方案目录、Workspace 权益、双账本汇总与一次性兑换批次的真实投影。"
    >
      <AdminBillingPanel snapshot={snapshot} />
    </AdminPageFrame>
  )
}
