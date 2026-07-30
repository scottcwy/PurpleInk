import { requireAdminSession } from '@/features/auth/page-session'
import { SecurityClient } from './security-client'

/** 安全监控：server page 自己包守卫（layout 守卫不传播），数据走 /api/admin/security。 */
export const dynamic = 'force-dynamic'

export default async function AdminSecurityPage() {
  await requireAdminSession('/admin/security')
  return <SecurityClient />
}
