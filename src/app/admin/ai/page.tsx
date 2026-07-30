import { requireAdminSession } from '@/features/auth/page-session'
import { AiClient } from './ai-client'

/** AI 调用审计：server page 自己包守卫（layout 守卫不传播），数据走 /api/admin/ai。 */
export const dynamic = 'force-dynamic'

export default async function AdminAiPage() {
  await requireAdminSession('/admin/ai')
  return <AiClient />
}
