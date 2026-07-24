import { authorizeCaptureTask, captureJsonRoute } from "@/lib/capture/http";
import { getCaptureControlPlane, getCaptureWorkloadToken } from "@/lib/capture/runtime";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return captureJsonRoute(request, async (body) => {
    const jobId = (await context.params).id;
    const scope = { workspaceId: String(body.workspaceId), jobId, attempt: Number(body.attempt) };
    authorizeCaptureTask(request, getCaptureWorkloadToken(), scope);
    const entries = Array.isArray(body.entries) ? body.entries : [];
    return { uploads: await getCaptureControlPlane().signUploads({
      ...scope, leaseToken: String(body.leaseToken),
      entries: entries.map((entry) => {
        const value = entry as Record<string, unknown>;
        return { r2Key: String(value.r2Key), mimeType: String(value.mimeType), bytes: Number(value.bytes), sha256: String(value.sha256), redactionStatus: String(value.redactionStatus) as "passed" | "blocked" | "needs_review" };
      }),
    }) };
  });
}
