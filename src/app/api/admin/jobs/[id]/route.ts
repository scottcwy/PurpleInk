import { withAdminSession } from "@/features/auth";
import { getAdminJob } from "@/features/admin";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withAdminSession(
    async () => {
      const { id } = await params;
      if (!UUID_PATTERN.test(id)) {
        return Response.json(
          { ok: false, error: "任务不存在" },
          { status: 404 }
        );
      }
      const items = await getAdminJob(id);
      if (!items)
        return Response.json(
          { ok: false, error: "任务不存在" },
          { status: 404 }
        );
      return Response.json({ ok: true, job: { items } });
    },
    { routeGroup: "admin-jobs-detail" }
  );
}
