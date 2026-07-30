import { requireAdminSession } from '@/features/auth/page-session'
import { JobsClient } from './jobs-client'

/** 任务监控：server page 自己包守卫（layout 守卫不传播），数据全走 /api/admin/jobs。 */
export const dynamic = 'force-dynamic'

export default async function AdminJobsPage() {
  await requireAdminSession('/admin/jobs')
  return <JobsClient />
}
