import { requireAdminSession } from "@/features/auth/page-session";
import { listAdminJobs } from "@/features/admin";
import { AdminJobsPanel } from "@/features/admin/ui/jobs-panel";
import { AdminPageHeader } from "@/features/admin/ui/admin-shell";

export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
  await requireAdminSession("/admin/jobs");
  const jobs = await listAdminJobs({ pageSize: 100 });
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="工作流任务"
        description="当前 pipeline_runs 与 task_attempts 的脱敏只读投影，不提供队列控制操作。"
      />
      <AdminJobsPanel page={jobs} />
    </div>
  );
}
