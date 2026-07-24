import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueCaptureTaskToken } from "@/lib/capture/http";

const mocks = vi.hoisted(() => ({
  closeHandoff: vi.fn(),
  getHandoffStatus: vi.fn(),
  completeAttempt: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
}));

vi.mock("@/lib/capture/runtime", () => ({
  getCaptureControlPlane: () => mocks,
  getCaptureWorkloadToken: () => "capture-workload-token-with-at-least-32-bytes",
}));

import { POST as callback } from "@/app/api/internal/capture/jobs/[id]/callback/route";
import { POST as handoff } from "@/app/api/internal/capture/jobs/[id]/handoff/route";

const secret = "capture-workload-token-with-at-least-32-bytes";
const taskToken = issueCaptureTaskToken(secret, {
  workspaceId: "workspace-1", jobId: "job-1", attempt: 2, expiresAt: Date.now() + 60_000,
});
const headers = {
  authorization: `Bearer ${taskToken}`,
  "content-type": "application/json",
};
const context = { params: Promise.resolve({ id: "job-1" }) };

describe("capture route dispatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dispatches successful callbacks by persisted CaptureSession kind", async () => {
    mocks.completeAttempt.mockResolvedValue({ manifestHash: "a".repeat(64) });
    const manifest = { schemaVersion: "evidence-manifest/v1" };
    const response = await callback(new Request("https://purpleink.test/callback", {
      method: "POST",
      headers,
      body: JSON.stringify({ workspaceId: "workspace-1", attempt: 2, leaseToken: "lease", status: "completed", manifest }),
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.completeAttempt).toHaveBeenCalledWith({
      workspaceId: "workspace-1", jobId: "job-1", attempt: 2, leaseToken: "lease", manifest,
    });
    expect(mocks.complete).not.toHaveBeenCalled();

    const crossWorkspace = await callback(new Request("https://purpleink.test/callback", {
      method: "POST",
      headers,
      body: JSON.stringify({ workspaceId: "workspace-2", attempt: 2, leaseToken: "lease", status: "completed", manifest }),
    }), context);
    expect(crossWorkspace.status).toBe(401);
    expect(mocks.completeAttempt).toHaveBeenCalledTimes(1);
  });

  it("closes a handoff and resumes the current attempt", async () => {
    mocks.closeHandoff.mockResolvedValue({ closed: true, resumed: true });
    const response = await handoff(new Request("https://purpleink.test/handoff", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "close", workspaceId: "workspace-1", attempt: 2, leaseToken: "lease", handoffId: "handoff-1" }),
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.closeHandoff).toHaveBeenCalledWith({
      workspaceId: "workspace-1", jobId: "job-1", attempt: 2, leaseToken: "lease", handoffId: "handoff-1",
    });
  });

  it("returns handoff status only through the current scoped task", async () => {
    mocks.getHandoffStatus.mockResolvedValue({ closed: false, resumed: false });
    const response = await handoff(new Request("https://purpleink.test/handoff", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "status", workspaceId: "workspace-1", attempt: 2, leaseToken: "lease", handoffId: "handoff-1" }),
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.getHandoffStatus).toHaveBeenCalledWith({
      workspaceId: "workspace-1", jobId: "job-1", attempt: 2, leaseToken: "lease", handoffId: "handoff-1",
    });
  });
});
