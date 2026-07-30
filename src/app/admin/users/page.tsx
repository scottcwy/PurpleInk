import { requireAdminSession } from '@/features/auth/page-session'
import { UsersClient } from './users-client'

/** 用户管理：server page 自己包守卫（layout 守卫不传播），数据全走 /api/admin/users。 */
export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  await requireAdminSession('/admin/users')
  return <UsersClient />
}
