import { authorizeCaptureTask, captureJsonRoute } from "@/lib/capture/http";
import { CaptureControlError } from "@/lib/capture/control-plane";
import { getCaptureControlPlane, getCaptureWorkloadToken } from "@/lib/capture/runtime";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return captureJsonRoute(request, async (body) => {
    const jobId = (await context.params).id;
    const scope = { workspaceId: String(body.workspaceId), jobId, attempt: Number(body.attempt) };
    authorizeCaptureTask(request, getCaptureWorkloadToken(), scope);
    if (body.action === "close") {
      return getCaptureControlPlane().closeHandoff({
        ...scope, leaseToken: String(body.leaseToken),
        handoffId: String(body.handoffId),
      });
    }
    if (body.action === "status") {
      return getCaptureControlPlane().getHandoffStatus({
        ...scope, leaseToken: String(body.leaseToken),
        handoffId: String(body.handoffId),
      });
    }
    if (body.action !== undefined && body.action !== "create") {
      throw new CaptureControlError("INVALID_HANDOFF_ACTION", "handoff action must be create, status, or close");
    }
    return getCaptureControlPlane().createHandoff({
      ...scope, leaseToken: String(body.leaseToken),
      remoteControlUrl: String(body.remoteControlUrl), ttlMs: Number(body.ttlMs),
    });
  });
}
