import { requireAdminSession } from "@/features/auth/page-session";
import { getAdminAiAudit } from "@/features/admin";
import { AdminAiAuditPanel } from "@/features/admin/ui/ai-audit-panel";
import { AdminPageHeader } from "@/features/admin/ui/admin-shell";

export const dynamic = "force-dynamic";

export default async function AdminAiPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireAdminSession("/admin/ai");
  const { days } = await searchParams;
  const snapshot = await getAdminAiAudit(parseDays(days));
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="AI 审计"
        description="ai_invocations v3 身份与双账本成本的跨 workspace 脱敏聚合。"
      />
      <AdminAiAuditPanel snapshot={snapshot} />
    </div>
  );
}

function parseDays(value: string | undefined): number {
  const parsed = Number(value ?? 7);
  return Number.isInteger(parsed) ? parsed : 7;
}
