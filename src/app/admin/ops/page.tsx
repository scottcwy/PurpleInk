import { requireAdminSession } from "@/features/auth/page-session";
import { getAdminOpsSnapshot } from "@/features/admin";
import { AdminPageFrame } from "@/features/admin/ui/admin-page-frame";
import { AdminOpsPanel } from "@/features/admin/ui/ops-panel";

export const dynamic = "force-dynamic";

export default async function AdminOpsPage() {
  await requireAdminSession("/admin/ops");
  const snapshot = await getAdminOpsSnapshot();
  return (
    <AdminPageFrame
      title="运行状态"
      description="队列、租约、dispatch ticket、冷却与 Provider 池的只读事实，不提供第二套控制面。"
    >
      <AdminOpsPanel snapshot={snapshot} />
    </AdminPageFrame>
  );
}
