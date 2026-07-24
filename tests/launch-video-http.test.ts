import { describe, expect, it, vi } from "vitest";

import { LaunchVideoHttpController } from "@/lib/launch-video/http";

const secret = "launch-video-workload-secret-at-least-32-bytes";
const requestBody = {
  jobId: "90000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000001",
  attempt: 1,
  idempotencyKey: "launch-http-1",
  skillInput: { workspaceId: "00000000-0000-4000-8000-000000000001" },
};

const jsonRequest = (url: string, body: unknown, token: string) => new Request(url, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("LaunchVideoHttpController", () => {
  it("issues a scoped task token and executes the matching request", async () => {
    const runner = { run: vi.fn(async () => ({ status: "succeeded" })), publishCallback: vi.fn() };
    const controller = new LaunchVideoHttpController({ runner, secret, now: () => 1_000 });
    const created = await controller.create(jsonRequest("http://local/jobs", requestBody, secret));
    expect(created.status).toBe(200);
    const bootstrap = await created.json();

    const response = await controller.execute(
      jsonRequest("http://local/jobs/1/execute", requestBody, bootstrap.workloadToken),
      requestBody.jobId
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "succeeded" });
    expect(runner.run).toHaveBeenCalledWith(requestBody);
  });

  it("rejects a token replayed for another workspace or job", async () => {
    const runner = { run: vi.fn(), publishCallback: vi.fn() };
    const controller = new LaunchVideoHttpController({ runner, secret, now: () => 1_000 });
    const created = await controller.create(jsonRequest("http://local/jobs", requestBody, secret));
    const bootstrap = await created.json();

    const response = await controller.execute(
      jsonRequest("http://local/jobs/other/execute", { ...requestBody, jobId: "other-job", workspaceId: "attacker" }, bootstrap.workloadToken),
      "other-job"
    );
    expect(response.status).toBe(401);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("rejects an expired task token", async () => {
    let now = 1_000;
    const runner = { run: vi.fn(), publishCallback: vi.fn() };
    const controller = new LaunchVideoHttpController({ runner, secret, now: () => now, ttlMs: 100 });
    const created = await controller.create(jsonRequest("http://local/jobs", requestBody, secret));
    const bootstrap = await created.json();
    now = 1_101;

    const response = await controller.execute(
      jsonRequest("http://local/jobs/1/execute", requestBody, bootstrap.workloadToken),
      requestBody.jobId
    );
    expect(response.status).toBe(401);
  });

  it("authenticates a fenced publication callback", async () => {
    const runner = { run: vi.fn(), publishCallback: vi.fn(async () => undefined) };
    const controller = new LaunchVideoHttpController({ runner, secret, now: () => 1_000 });
    const created = await controller.create(jsonRequest("http://local/jobs", requestBody, secret));
    const bootstrap = await created.json();
    const publication = { workspaceId: requestBody.workspaceId, attempt: 1, bundleHash: "a".repeat(64) };

    const response = await controller.callback(
      jsonRequest("http://local/jobs/1/callback", publication, bootstrap.workloadToken),
      requestBody.jobId
    );
    expect(response.status).toBe(200);
    expect(runner.publishCallback).toHaveBeenCalledWith({ ...publication, jobId: requestBody.jobId });
  });
});
