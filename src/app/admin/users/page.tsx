import { listAdminUsers } from '@/features/admin'
import { AdminPageFrame } from '@/features/admin/ui/admin-page-frame'
import { AdminUsersPanel } from '@/features/admin/ui/admin-users-panel'
import { requireAdminSession } from '@/features/auth/page-session'

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  const session = await requireAdminSession('/admin/users')
  const page = await listAdminUsers()
  return (
    <AdminPageFrame
      title="账号管理"
      description="创建、编辑、停用或恢复真实账号；停用会立即注销该账号全部会话。"
    >
      <AdminUsersPanel page={page} actorUserId={session.userId} />
    </AdminPageFrame>
  )
}
