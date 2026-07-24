import assert from "node:assert/strict";
import test from "node:test";

import { CaptureControlPlaneClient } from "../src/control-plane-client.mjs";

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("worker drives the persisted lease, event, upload, and completion protocol", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url.endsWith("/lease")) return response({ leaseToken: "lease-token", payload: { schemaVersion: "capture-worker-job/v1" } });
    return response({ accepted: true });
  };
  const manifest = { schemaVersion: "evidence-manifest/v1", entries: [] };
  const publisher = async (input) => {
    calls.push({ url: "publisher", body: input });
  };
  const client = new CaptureControlPlaneClient({
    baseUrl: "https://control.test/api/internal/capture",
    workloadToken: "task-token",
    workspaceId: "workspace-1",
    jobId: "job-1",
    attempt: 2,
    fetcher,
    publisher,
  });

  const result = await client.run({ outputDir: "/output", adapter: { run: async () => manifest } });

  assert.equal(result, manifest);
  assert.deepEqual(calls.map(({ url }) => url), [
    "https://control.test/api/internal/capture/jobs/job-1/lease",
    "https://control.test/api/internal/capture/jobs/job-1/heartbeat",
    "https://control.test/api/internal/capture/jobs/job-1/events",
    "publisher",
    "https://control.test/api/internal/capture/jobs/job-1/events",
    "https://control.test/api/internal/capture/jobs/job-1/callback",
  ]);
  assert.equal(calls.at(-1).body.status, "completed");
});

test("worker reports a stable failure through the current lease", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url.endsWith("/lease")) return response({ leaseToken: "lease-token", payload: {} });
    return response({ accepted: true });
  };
  const client = new CaptureControlPlaneClient({
    baseUrl: "https://control.test/api/internal/capture",
    workloadToken: "task-token",
    workspaceId: "workspace-1",
    jobId: "job-1",
    attempt: 2,
    fetcher,
    publisher: async () => undefined,
  });

  await assert.rejects(() => client.run({
    outputDir: "/output",
    adapter: { run: async () => { const error = new Error("checkpoint missing"); error.code = "ASSERTION_FAILED"; throw error; } },
  }), /checkpoint missing/);
  assert.equal(calls.at(-1).url, "https://control.test/api/internal/capture/jobs/job-1/callback");
  assert.equal(calls.at(-1).body.status, "failed");
  assert.equal(calls.at(-1).body.errorCode, "ASSERTION_FAILED");
});

test("worker pauses for a handoff until the same attempt is explicitly resumed", async () => {
  const calls = [];
  let statusChecks = 0;
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url.endsWith("/lease")) return response({ leaseToken: "lease-token", payload: { handoff: { remoteControlUrl: "https://browser.test/session" } } });
    if (url.endsWith("/handoff") && body.action === "create") return response({ id: "handoff-1" });
    if (url.endsWith("/handoff") && body.action === "status") {
      statusChecks += 1;
      return response({ closed: statusChecks === 2, resumed: statusChecks === 2 });
    }
    return response({ accepted: true });
  };
  const client = new CaptureControlPlaneClient({
    baseUrl: "https://control.test/api/internal/capture",
    workloadToken: "task-token",
    workspaceId: "workspace-1",
    jobId: "job-1",
    attempt: 2,
    fetcher,
    publisher: async () => undefined,
    handoffPollIntervalMs: 0,
  });
  let resumed = false;
  await client.run({
    outputDir: "/output",
    adapter: {
      run: async (_job, _output, runtime) => {
        await runtime.handoff({ prompt: "Complete login" });
        resumed = true;
        return { schemaVersion: "evidence-manifest/v1", entries: [] };
      },
    },
  });

  assert.equal(resumed, true);
  assert.equal(statusChecks, 2);
  assert.equal(calls.find(({ body }) => body.action === "create").body.remoteControlUrl, "https://browser.test/session");
});
