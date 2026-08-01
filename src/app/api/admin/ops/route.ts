import { withAdminSession } from "@/features/auth";
import { getAdminOpsSnapshot } from "@/features/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withAdminSession(
    async () => Response.json({ ok: true, ...(await getAdminOpsSnapshot()) }),
    {
      routeGroup: "admin-ops",
    }
  );
}
