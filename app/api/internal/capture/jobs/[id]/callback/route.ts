import { authorizeCaptureTask, captureJsonRoute } from "@/lib/capture/http";
import { CaptureControlError } from "@/lib/capture/control-plane";
import { getCaptureControlPlane, getCaptureWorkloadToken } from "@/lib/capture/runtime";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return captureJsonRoute(request, async (body) => {
    const jobId = (await context.params).id;
    const scope = { workspaceId: String(body.workspaceId), jobId, attempt: Number(body.attempt) };
    authorizeCaptureTask(request, getCaptureWorkloadToken(), scope);
    const common = { ...scope, leaseToken: String(body.leaseToken) };
    if (body.status === "completed") {
      return getCaptureControlPlane().completeAttempt({ ...common, manifest: body.manifest as never });
    }
    if (body.status === "failed") {
      return getCaptureControlPlane().fail({ ...common, errorCode: String(body.errorCode), ...(typeof body.diagnostic === "string" ? { diagnostic: body.diagnostic } : {}) });
    }
    throw new CaptureControlError("INVALID_CALLBACK", "callback status must be completed or failed");
  });
}
