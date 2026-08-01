import { requireAdminSession } from "@/features/auth/page-session";
import { getAdminSecuritySnapshot } from "@/features/admin";
import { AdminPageFrame } from "@/features/admin/ui/admin-page-frame";
import { AdminSecurityPanel } from "@/features/admin/ui/security-panel";

export const dynamic = "force-dynamic";

export default async function AdminSecurityPage() {
  await requireAdminSession("/admin/security");
  const snapshot = await getAdminSecuritySnapshot();
  return (
    <AdminPageFrame
      title="安全观测"
      description="仅聚合匿名 route group 与认证限流桶；不展示 URL、query、身份或 IP。"
    >
      <AdminSecurityPanel snapshot={snapshot} />
    </AdminPageFrame>
  );
}
