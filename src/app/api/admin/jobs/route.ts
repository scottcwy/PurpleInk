import { withAdminSession } from "@/features/auth";
import { listAdminJobs } from "@/features/admin";
import { positiveQueryInteger } from "@/features/admin/http-query";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withAdminSession(
    async () => {
      const query = new URL(request.url).searchParams;
      const data = await listAdminJobs({
        status: query.get("status") ?? undefined,
        page: positiveQueryInteger(query.get("page"), 1, 10_000),
        pageSize: positiveQueryInteger(query.get("pageSize"), 50, 100),
      });
      return Response.json({ ok: true, ...data });
    },
    { routeGroup: "admin-jobs" }
  );
}
