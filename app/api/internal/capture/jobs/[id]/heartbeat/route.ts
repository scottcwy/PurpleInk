import { authorizeCaptureTask, captureJsonRoute } from "@/lib/capture/http";
import { getCaptureControlPlane, getCaptureWorkloadToken } from "@/lib/capture/runtime";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return captureJsonRoute(request, async (body) => {
    const jobId = (await context.params).id;
    const scope = { workspaceId: String(body.workspaceId), jobId, attempt: Number(body.attempt) };
    authorizeCaptureTask(request, getCaptureWorkloadToken(), scope);
    return getCaptureControlPlane().heartbeat({
      ...scope, leaseToken: String(body.leaseToken),
    });
  });
}
