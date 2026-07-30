import { requireAdminSession } from '@/features/auth/page-session'
import { OpsClient } from './ops-client'

/** 系统运维：server page 自己包守卫（layout 守卫不传播），数据全走 /api/admin/ops。 */
export const dynamic = 'force-dynamic'

export default async function AdminOpsPage() {
  await requireAdminSession('/admin/ops')
  return <OpsClient />
}
