import { randomUUID } from "node:crypto";

import { authorizeCaptureWorker, captureJsonRoute, issueCaptureTaskToken } from "@/lib/capture/http";
import { getCaptureControlPlane, getCaptureWorkloadToken } from "@/lib/capture/runtime";

export async function POST(request: Request) {
  return captureJsonRoute(request, async (body) => {
    authorizeCaptureWorker(request, getCaptureWorkloadToken());
    const id = typeof body.id === "string" ? body.id : randomUUID();
    const workspaceId = String(body.workspaceId);
    const attempt = Number(body.attempt);
    const result = await getCaptureControlPlane().createAttempt({
      id,
      workspaceId,
      captureSessionId: String(body.captureSessionId),
      attempt,
      imageDigest: String(body.imageDigest),
      region: String(body.region),
      payload: body.payload ?? {},
    });
    return {
      ...result,
      workloadToken: issueCaptureTaskToken(getCaptureWorkloadToken(), {
        workspaceId, jobId: id, attempt, expiresAt: Date.now() + 65 * 60_000,
      }),
    };
  });
}
