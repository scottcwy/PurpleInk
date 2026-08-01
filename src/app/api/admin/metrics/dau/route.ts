import { withAdminSession } from "@/features/auth";
import { getAdminDauMetrics } from "@/features/admin";
import { positiveQueryInteger } from "@/features/admin/http-query";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withAdminSession(
    async () => {
      const days = positiveQueryInteger(
        new URL(request.url).searchParams.get("days"),
        30,
        90
      );
      return Response.json({ ok: true, ...(await getAdminDauMetrics(days)) });
    },
    { routeGroup: "admin-metrics-dau" }
  );
}
