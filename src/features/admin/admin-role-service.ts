import 'server-only'
import type { UserRole } from '@/lib/db/schema'
import { setUserRoleByEmail } from './admin-role-repository'

export type AdminRoleErrorCode = 'USER_NOT_FOUND' | 'LAST_ACTIVE_ADMIN'

export class AdminRoleError extends Error {
  constructor(readonly code: AdminRoleErrorCode) {
    super(code === 'USER_NOT_FOUND' ? '用户不存在' : '不能撤销最后一个活跃管理员')
    this.name = 'AdminRoleError'
  }
}

export async function setGlobalUserRole(input: {
  email: string
  role: UserRole
}): Promise<{ userId: string; previousRole: UserRole; role: UserRole }> {
  const result = await setUserRoleByEmail({
    email: input.email.trim().toLowerCase(),
    role: input.role,
  })
  if (result.outcome === 'not_found') throw new AdminRoleError('USER_NOT_FOUND')
  if (result.outcome === 'last_active_admin') {
    throw new AdminRoleError('LAST_ACTIVE_ADMIN')
  }
  return result
}
