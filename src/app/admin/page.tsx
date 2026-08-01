import {
  CircleCheck,
  Clock3,
  LayoutDashboard,
  ShieldCheck,
} from "lucide-react";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { requireAdminSession } from "@/features/auth/page-session";
import { getAdminOverview } from "@/features/admin";
import { AdminPageHeader } from "@/features/admin/ui/admin-shell";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  await requireAdminSession("/admin");
  const overview = await getAdminOverview();
  const metrics = [
    { label: "全部用户", value: overview.users.total, icon: LayoutDashboard },
    { label: "活跃用户", value: overview.users.active, icon: CircleCheck },
    { label: "停用用户", value: overview.users.disabled, icon: ShieldCheck },
    { label: "有效会话", value: overview.activeSessions, icon: Clock3 },
  ];
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="运营概览"
        description="用户、会话与 PostgreSQL 时钟的实时只读投影。"
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{label}</CardTitle>
              <Icon aria-hidden className="text-ds-text-muted size-5" />
            </div>
            <CardBody className="text-ds-text text-3xl font-semibold tabular-nums">
              {value}
            </CardBody>
          </Card>
        ))}
      </div>
      <Card>
        <CardTitle>数据库时间</CardTitle>
        <CardBody className="text-ds-text font-mono">
          {overview.databaseTime}
        </CardBody>
      </Card>
    </div>
  );
}
