import { describe, expect, it } from "vitest";

import {
  authorizeCaptureTask,
  authorizeCaptureWorker,
  captureErrorResponse,
  issueCaptureTaskToken,
} from "@/lib/capture/http";
import { CaptureControlError } from "@/lib/capture/control-plane";

const secret = "capture-workload-token-with-at-least-32-bytes";

describe("capture worker HTTP boundary", () => {
  it("accepts only the configured Bearer workload credential", () => {
    const request = new Request("https://purpleink.test/api/internal/capture/jobs", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(() => authorizeCaptureWorker(request, secret)).not.toThrow();
    expect(() => authorizeCaptureWorker(request, `${secret}-different`)).toThrow(/Unauthorized/);
  });

  it("maps structured control errors without leaking internals", async () => {
    const response = captureErrorResponse(new CaptureControlError("STALE_ATTEMPT", "fenced"));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "STALE_ATTEMPT", message: "fenced" } });
  });

  it("accepts only unexpired task credentials scoped to workspace, job, and attempt", () => {
    const token = issueCaptureTaskToken(secret, {
      workspaceId: "workspace-a",
      jobId: "job-a",
      attempt: 2,
      expiresAt: Date.now() + 60_000,
    });
    const request = new Request("https://purpleink.test/callback", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(() => authorizeCaptureTask(request, secret, {
      workspaceId: "workspace-a", jobId: "job-a", attempt: 2,
    })).not.toThrow();
    expect(() => authorizeCaptureTask(request, secret, {
      workspaceId: "workspace-b", jobId: "job-a", attempt: 2,
    })).toThrow(/Unauthorized/);
    const expired = issueCaptureTaskToken(secret, {
      workspaceId: "workspace-a", jobId: "job-a", attempt: 2, expiresAt: Date.now() - 1,
    });
    expect(() => authorizeCaptureTask(new Request("https://purpleink.test/callback", {
      headers: { authorization: `Bearer ${expired}` },
    }), secret, { workspaceId: "workspace-a", jobId: "job-a", attempt: 2 })).toThrow(/Unauthorized/);
  });
});
