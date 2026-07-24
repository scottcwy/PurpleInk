import { authorizeCaptureTask, captureJsonRoute } from "@/lib/capture/http";
import { getCaptureControlPlane, getCaptureWorkloadToken } from "@/lib/capture/runtime";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return captureJsonRoute(request, async (body) => {
    const jobId = (await context.params).id;
    const scope = { workspaceId: String(body.workspaceId), jobId, attempt: Number(body.attempt) };
    authorizeCaptureTask(request, getCaptureWorkloadToken(), scope);
    const common = { ...scope, leaseToken: String(body.leaseToken) };
    const events = Array.isArray(body.events) ? body.events : [body];
    const results = [];
    for (const event of events) {
      if (typeof event !== "object" || event === null || Array.isArray(event)) continue;
      const value = event as Record<string, unknown>;
      results.push(await getCaptureControlPlane().appendEvent({ ...common, seq: Number(value.seq), eventType: String(value.eventType), payload: value.payload ?? {} }));
    }
    return { events: results };
  });
}
