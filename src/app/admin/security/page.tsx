import { requireAdminSession } from "@/features/auth/page-session";
import { getAdminSecuritySnapshot } from "@/features/admin";
import { AdminPageHeader } from "@/features/admin/ui/admin-shell";
import { AdminSecurityPanel } from "@/features/admin/ui/security-panel";

export const dynamic = "force-dynamic";

export default async function AdminSecurityPage() {
  await requireAdminSession("/admin/security");
  const snapshot = await getAdminSecuritySnapshot();
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="安全观测"
        description="仅聚合匿名 route group 与认证限流桶；不展示 URL、query、身份或 IP。"
      />
      <AdminSecurityPanel snapshot={snapshot} />
    </div>
  );
}
