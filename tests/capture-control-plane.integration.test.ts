import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { R2ObjectStore } from "@purpleink/r2-store";
import { PostgresCaptureControlPlane } from "@/lib/capture/control-plane";

const exec = promisify(execFile);
const pgContainer = `purpleink-capture-pg-${randomUUID()}`;
const minioContainer = `purpleink-capture-r2-${randomUUID()}`;
const workspaceId = "00000000-0000-4000-8000-000000000001";
const productId = "10000000-0000-4000-8000-000000000001";
const releaseId = "20000000-0000-4000-8000-000000000001";
const sessionId = "30000000-0000-4000-8000-000000000001";
const captureRunId = "40000000-0000-4000-8000-000000000001";
const flowId = "50000000-0000-4000-8000-000000000001";
const flowVersionId = "60000000-0000-4000-8000-000000000001";
const failedReleaseId = "20000000-0000-4000-8000-000000000002";
const failedSessionId = "30000000-0000-4000-8000-000000000002";
const failedCaptureRunId = "40000000-0000-4000-8000-000000000002";
const discoveryReleaseId = "20000000-0000-4000-8000-000000000003";
const discoveryBriefId = "21000000-0000-4000-8000-000000000003";
const discoveryFlowId = "50000000-0000-4000-8000-000000000003";
const discoveryFlowVersionId = "60000000-0000-4000-8000-000000000003";
const discoverySessionId = "30000000-0000-4000-8000-000000000003";
const discoveryRunId = "40000000-0000-4000-8000-000000000003";
const imageDigest = "sha256:ffc33305f7b4b04057ae4a0caa70aad4fde87454fb403a1a22e7f931707dfcf9";
const discoveredFlow = {
  schemaVersion: "product-flow/v1",
  productId,
  startUrl: "https://product.example.com",
  allowedOrigins: ["https://product.example.com"],
  viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  locale: "en-US",
  timezone: "UTC",
  nodes: [1, 2, 3].map((order) => ({
    id: `d0000000-0000-4000-8000-00000000000${order}`,
    order, title: `Discovered ${order}`, intent: `Verify ${order}`, capabilityIds: [],
    actions: [{ id: `d1000000-0000-4000-8000-00000000000${order}`, kind: "navigate", expectedUrl: "https://product.example.com", timeoutMs: 5_000, effect: "read" }],
    checkpoints: [{ id: `d2000000-0000-4000-8000-00000000000${order}`, kind: "url_matches", expected: "product\\.example\\.com", timeoutMs: 5_000 }],
  })),
  edges: [
    { from: "d0000000-0000-4000-8000-000000000001", to: "d0000000-0000-4000-8000-000000000002" },
    { from: "d0000000-0000-4000-8000-000000000002", to: "d0000000-0000-4000-8000-000000000003" },
  ],
};
let sql: postgres.Sql;
let store: R2ObjectStore;
let control: PostgresCaptureControlPlane;
let objectStoreUnavailable = false;

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

beforeAll(async () => {
  await exec("docker", ["run", "-d", "--rm", "--name", pgContainer, "-e", "POSTGRES_PASSWORD=purpleink", "-e", "POSTGRES_USER=purpleink", "-e", "POSTGRES_DB=purpleink", "-p", "127.0.0.1::5432", "postgres:16"]);
  const pgPort = (await exec("docker", ["port", pgContainer, "5432/tcp"])).stdout.trim().split(":").at(-1);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { sql = postgres(`postgres://purpleink:purpleink@127.0.0.1:${pgPort}/purpleink`); await sql`select 1`; break; }
    catch { await sql?.end().catch(() => undefined); await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  const migrationsUrl = new URL("../db/migrations/", import.meta.url);
  for (const file of (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql")).sort()) await sql.unsafe(await readFile(new URL(file, migrationsUrl), "utf8"));

  await exec("docker", ["run", "-d", "--rm", "--name", minioContainer, "-e", "MINIO_ROOT_USER=purpleinktest", "-e", "MINIO_ROOT_PASSWORD=purpleinktestsecret", "-p", "127.0.0.1::9000", "quay.io/minio/minio@sha256:54d3d6a0a58fb25b4e9943d1db3828d3b4de44666f911381b4fda57175488194", "server", "/data"]);
  const r2Port = (await exec("docker", ["port", minioContainer, "9000/tcp"])).stdout.trim().split(":").at(-1);
  const endpoint = `http://127.0.0.1:${r2Port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${endpoint}/minio/health/live`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  store = new R2ObjectStore({ endpoint, region: "us-east-1", bucket: "capture", accessKeyId: "purpleinktest", secretAccessKey: "purpleinktestsecret" });
  await store.createBucket();

  await sql`insert into workspaces(id,name,slug) values(${workspaceId},'Capture','capture')`;
  await sql`insert into products(id,workspace_id,name,canonical_url) values(${productId},${workspaceId},'Product','https://product.example.com')`;
  await sql`insert into releases(id,workspace_id,product_id,name,stage) values(${releaseId},${workspaceId},${productId},'Release','capturing')`;
  await sql`insert into product_flows(id,workspace_id,product_id,name) values(${flowId},${workspaceId},${productId},'Flow')`;
  await sql`insert into product_flow_versions(id,workspace_id,product_flow_id,version,schema_version,payload,content_hash,status,approved_at) values(${flowVersionId},${workspaceId},${flowId},1,'product-flow/v1',${sql.json({ nodes: [{ id: "result" }] })},${"a".repeat(64)},'approved',now())`;
  await sql`insert into capture_sessions(id,workspace_id,product_id,release_id,kind,state,connectivity,allowed_origins,expires_at,hard_expires_at) values(${sessionId},${workspaceId},${productId},${releaseId},'capture','created','disconnected',${sql.json(["https://product.example.com"])},now()+interval '30 minutes',now()+interval '60 minutes')`;
  await sql`insert into capture_runs(id,workspace_id,release_id,flow_version_id,capture_session_id,status) values(${captureRunId},${workspaceId},${releaseId},${flowVersionId},${sessionId},'pending')`;
  await sql`insert into releases(id,workspace_id,product_id,name,stage) values(${failedReleaseId},${workspaceId},${productId},'Failed release','capturing')`;
  await sql`insert into capture_sessions(id,workspace_id,product_id,release_id,kind,state,connectivity,allowed_origins,expires_at,hard_expires_at) values(${failedSessionId},${workspaceId},${productId},${failedReleaseId},'capture','created','disconnected',${sql.json(["https://product.example.com"])},now()+interval '30 minutes',now()+interval '60 minutes')`;
  await sql`insert into capture_runs(id,workspace_id,release_id,flow_version_id,capture_session_id,status) values(${failedCaptureRunId},${workspaceId},${failedReleaseId},${flowVersionId},${failedSessionId},'pending')`;
  await sql`insert into releases(id,workspace_id,product_id,name,stage) values(${discoveryReleaseId},${workspaceId},${productId},'Discovery release','flow_discovering')`;
  await sql`insert into release_brief_versions(id,workspace_id,release_id,version,schema_version,payload,content_hash,status,approved_at) values(${discoveryBriefId},${workspaceId},${discoveryReleaseId},1,'release-brief/v1','{}',${"c".repeat(64)},'approved',now())`;
  await sql`update releases set brief_version_id=${discoveryBriefId} where workspace_id=${workspaceId} and id=${discoveryReleaseId}`;
  await sql`insert into product_flows(id,workspace_id,product_id,name) values(${discoveryFlowId},${workspaceId},${productId},'Discovery flow')`;
  await sql`insert into capture_sessions(id,workspace_id,product_id,release_id,kind,state,connectivity,allowed_origins,expires_at,hard_expires_at) values(${discoverySessionId},${workspaceId},${productId},${discoveryReleaseId},'discovery','created','disconnected',${sql.json(["https://product.example.com"])},now()+interval '30 minutes',now()+interval '60 minutes')`;
  await sql`insert into discovery_runs(id,workspace_id,release_id,release_brief_version_id,product_flow_id,capture_session_id,status) values(${discoveryRunId},${workspaceId},${discoveryReleaseId},${discoveryBriefId},${discoveryFlowId},${discoverySessionId},'running')`;
  control = new PostgresCaptureControlPlane(sql, {
    signPut: (input) => store.signPut(input),
    head: (key) => {
      if (objectStoreUnavailable) throw new Error("object store unavailable");
      return store.head(key);
    },
  });
}, 30_000);

afterAll(async () => {
  await sql?.end().catch(() => undefined);
  await exec("docker", ["rm", "-f", pgContainer]).catch(() => undefined);
  await exec("docker", ["rm", "-f", minioContainer]).catch(() => undefined);
});

describe("PostgreSQL Playwright capture control plane", () => {
  it("fences a lost lease and publishes only the recovered attempt", async () => {
    const firstJob = "70000000-0000-4000-8000-000000000001";
    const secondJob = "70000000-0000-4000-8000-000000000002";
    await control.createAttempt({ id: firstJob, workspaceId, captureSessionId: sessionId, attempt: 1, imageDigest, region: "test", payload: {} });
    const firstLease = await control.lease({ workspaceId, jobId: firstJob, attempt: 1, ttlMs: 30_000 });
    await control.createAttempt({ id: secondJob, workspaceId, captureSessionId: sessionId, attempt: 2, imageDigest, region: "test", payload: {} });
    const secondLease = await control.lease({ workspaceId, jobId: secondJob, attempt: 2, ttlMs: 30_000 });
    await control.heartbeat({ workspaceId, jobId: secondJob, attempt: 2, leaseToken: secondLease.leaseToken });
    const event = { workspaceId, jobId: secondJob, attempt: 2, leaseToken: secondLease.leaseToken, seq: 1, eventType: "node_started", payload: { nodeId: "result" } };
    expect(await control.appendEvent(event)).toEqual({ accepted: true, duplicate: false, seq: 1 });
    expect(await control.appendEvent(event)).toEqual({ accepted: true, duplicate: true, seq: 1 });
    const handoff = await control.createHandoff({ workspaceId, jobId: secondJob, attempt: 2, leaseToken: secondLease.leaseToken, remoteControlUrl: "https://browser.example.test/session", ttlMs: 60_000 });
    expect(await control.getHandoffStatus({ workspaceId, jobId: secondJob, attempt: 2, leaseToken: secondLease.leaseToken, handoffId: handoff.id })).toEqual({ closed: false, resumed: false });
    expect(await control.claimHandoff({ workspaceId, handoffId: handoff.id, claimToken: handoff.claimToken })).toEqual({ remoteControlUrl: "https://browser.example.test/session" });
    await expect(control.claimHandoff({ workspaceId, handoffId: handoff.id, claimToken: handoff.claimToken })).rejects.toMatchObject({ code: "HANDOFF_UNAVAILABLE" });
    const closeInput = { workspaceId, jobId: secondJob, attempt: 2, leaseToken: secondLease.leaseToken, handoffId: handoff.id };
    expect(await control.closeHandoff(closeInput)).toEqual({ closed: true, resumed: true });
    expect(await control.closeHandoff(closeInput)).toEqual({ closed: true, resumed: true });
    expect(await control.getHandoffStatus(closeInput)).toEqual({ closed: true, resumed: true });
    expect((await sql`select state from capture_sessions where workspace_id=${workspaceId} and id=${sessionId}`)[0]?.state).toBe("running");
    const artifacts = [
      ["result_screenshot", "image/png", Buffer.from("screenshot")],
      ["node_clip", "video/mp4", Buffer.from("clip")],
      ["assertion_report", "application/json", Buffer.from("{\"passed\":true}")],
      ["dom_summary", "application/json", Buffer.from("{\"nodes\":[]}")],
    ] as const;
    const entries = artifacts.map(([kind, mimeType, bytes]) => ({
      nodeId: "result", kind, mimeType, bytes: bytes.length, sha256: digest(bytes), redactionStatus: "passed" as const,
      r2Key: `workspaces/${workspaceId}/capture-sessions/${sessionId}/attempt-2/final/result/${kind}`,
    }));
    const uploads = await control.signUploads({ workspaceId, jobId: secondJob, attempt: 2, leaseToken: secondLease.leaseToken, entries });
    for (let index = 0; index < uploads.length; index += 1) {
      const upload = uploads[index];
      const artifact = artifacts[index];
      if (!upload || !artifact) throw new Error("signed upload count mismatch");
      const response = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: artifact[2] });
      expect(response.ok).toBe(true);
    }
    const manifest = { schemaVersion: "evidence-manifest/v1", workspaceId, captureSessionId: sessionId, jobId: secondJob, attempt: 2, runId: captureRunId, flowVersionId, imageDigest, actionJournalHash: "b".repeat(64), entries };

    await expect(control.complete({ workspaceId, jobId: firstJob, attempt: 1, leaseToken: firstLease.leaseToken, manifest: { ...manifest, jobId: firstJob, attempt: 1 } })).rejects.toMatchObject({ code: "STALE_ATTEMPT" });
    const result = await control.complete({ workspaceId, jobId: secondJob, attempt: 2, leaseToken: secondLease.leaseToken, manifest });
    expect(result.nodeEvidenceIds).toHaveLength(4);
    await sql`update capture_worker_jobs set lease_expires_at=now()-interval '1 second' where workspace_id=${workspaceId} and id=${secondJob}`;
    objectStoreUnavailable = true;
    try {
      expect(await control.complete({ workspaceId, jobId: secondJob, attempt: 2, leaseToken: secondLease.leaseToken, manifest })).toEqual(result);
    } finally {
      objectStoreUnavailable = false;
    }
    const [captureRun] = await sql`select status from capture_runs where workspace_id=${workspaceId} and id=${captureRunId}`;
    expect(captureRun?.status).toBe("completed");
    const [release] = await sql`select stage,capture_run_id from releases where workspace_id=${workspaceId} and id=${releaseId}`;
    expect(release).toMatchObject({ stage: "evidence_review", capture_run_id: captureRunId });
    expect(await sql`select id from node_evidence where workspace_id=${workspaceId}`).toHaveLength(4);
    expect(await sql`select id from evidence_manifests where workspace_id=${workspaceId} and session_id=${sessionId}`).toHaveLength(1);
  }, 30_000);

  it("persists a fenced failure and preserves the failed Release stage", async () => {
    const jobId = "70000000-0000-4000-8000-000000000003";
    const retryJobId = "70000000-0000-4000-8000-000000000005";
    await control.createAttempt({ id: jobId, workspaceId, captureSessionId: failedSessionId, attempt: 1, imageDigest, region: "test", payload: {} });
    const lease = await control.lease({ workspaceId, jobId, attempt: 1, ttlMs: 30_000 });
    await control.fail({ workspaceId, jobId, attempt: 1, leaseToken: lease.leaseToken, errorCode: "ASSERTION_FAILED", diagnostic: "result checkpoint missing" });

    expect((await sql`select status,error_code from capture_worker_jobs where workspace_id=${workspaceId} and id=${jobId}`)[0]).toMatchObject({ status: "failed", error_code: "ASSERTION_FAILED" });
    expect((await sql`select status from capture_runs where workspace_id=${workspaceId} and id=${failedCaptureRunId}`)[0]?.status).toBe("failed");
    expect((await sql`select lifecycle,stage,failed_from_stage from releases where workspace_id=${workspaceId} and id=${failedReleaseId}`)[0]).toMatchObject({ lifecycle: "failed", stage: "capturing", failed_from_stage: "capturing" });

    const retryInput = {
      workspaceId,
      releaseId: failedReleaseId,
      captureSessionId: failedSessionId,
      jobId: retryJobId,
      expectedRevision: 2,
      idempotencyKey: "retry-failed-capture",
      imageDigest,
      region: "test",
      payload: { recovery: true },
    };
    const retried = await control.retryCapture(retryInput);
    expect(retried).toMatchObject({ jobId: retryJobId, attempt: 2, revision: 3 });
    expect(await control.retryCapture(retryInput)).toEqual(retried);
    expect((await sql`select lifecycle,stage,failed_from_stage,revision from releases where workspace_id=${workspaceId} and id=${failedReleaseId}`)[0]).toMatchObject({ lifecycle: "active", stage: "capturing", failed_from_stage: null, revision: 3 });
    expect((await sql`select status,finished_at from capture_runs where workspace_id=${workspaceId} and id=${failedCaptureRunId}`)[0]).toMatchObject({ status: "running", finished_at: null });

    const retryLease = await control.lease({ workspaceId, jobId: retryJobId, attempt: 2, ttlMs: 30_000 });
    await expect(control.fail({ workspaceId, jobId, attempt: 1, leaseToken: lease.leaseToken, errorCode: "LATE_FAILURE" })).rejects.toMatchObject({ code: "STALE_ATTEMPT" });
    const bytes = Buffer.from("recovered screenshot");
    const entry = {
      nodeId: "result", kind: "result_screenshot", mimeType: "image/png",
      bytes: bytes.length, sha256: digest(bytes), redactionStatus: "passed" as const,
      r2Key: `workspaces/${workspaceId}/capture-sessions/${failedSessionId}/attempt-2/final/result/result.png`,
    };
    const [upload] = await control.signUploads({ workspaceId, jobId: retryJobId, attempt: 2, leaseToken: retryLease.leaseToken, entries: [entry] });
    if (!upload) throw new Error("missing recovery upload");
    expect((await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes })).ok).toBe(true);
    const manifest = { schemaVersion: "evidence-manifest/v1", workspaceId, captureSessionId: failedSessionId, jobId: retryJobId, attempt: 2, runId: failedCaptureRunId, flowVersionId, imageDigest, actionJournalHash: "f".repeat(64), entries: [entry] };
    expect((await control.complete({ workspaceId, jobId: retryJobId, attempt: 2, leaseToken: retryLease.leaseToken, manifest })).nodeEvidenceIds).toHaveLength(1);
    expect((await sql`select status from capture_runs where workspace_id=${workspaceId} and id=${failedCaptureRunId}`)[0]?.status).toBe("completed");
    expect((await sql`select lifecycle,stage,failed_from_stage from releases where workspace_id=${workspaceId} and id=${failedReleaseId}`)[0]).toMatchObject({ lifecycle: "active", stage: "evidence_review", failed_from_stage: null });
  });

  it("persists verified clean replay provenance and completes DiscoveryRun", async () => {
    const jobId = "70000000-0000-4000-8000-000000000004";
    await control.createAttempt({ id: jobId, workspaceId, captureSessionId: discoverySessionId, attempt: 1, imageDigest, region: "test", payload: {} });
    const lease = await control.lease({ workspaceId, jobId, attempt: 1, ttlMs: 30_000 });
    const bytes = Buffer.from("clean replay screenshot");
    const entry = { nodeId: "result", kind: "result_screenshot", mimeType: "image/png", bytes: bytes.length, sha256: digest(bytes), redactionStatus: "passed" as const, r2Key: `workspaces/${workspaceId}/capture-sessions/${discoverySessionId}/attempt-1/final/result/result.png` };
    const [upload] = await control.signUploads({ workspaceId, jobId, attempt: 1, leaseToken: lease.leaseToken, entries: [entry] });
    if (!upload) throw new Error("missing signed upload");
    expect((await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes })).ok).toBe(true);
    const manifest = { schemaVersion: "evidence-manifest/v1", workspaceId, captureSessionId: discoverySessionId, jobId, attempt: 1, runId: discoveryRunId, flowVersionId: discoveryFlowVersionId, candidateFlow: discoveredFlow, imageDigest, actionJournalHash: "e".repeat(64), entries: [entry] };

    const result = await control.completeAttempt({ workspaceId, jobId, attempt: 1, leaseToken: lease.leaseToken, manifest });
    await sql`update capture_worker_jobs set lease_expires_at=now()-interval '1 second' where workspace_id=${workspaceId} and id=${jobId}`;
    expect(await control.completeAttempt({ workspaceId, jobId, attempt: 1, leaseToken: lease.leaseToken, manifest })).toEqual(result);
    const [run] = await sql`select status,clean_replay_manifest_hash,clean_replay_worker_image_digest from discovery_runs where workspace_id=${workspaceId} and id=${discoveryRunId}`;
    expect(run).toMatchObject({ status: "completed", clean_replay_manifest_hash: result.manifestHash, clean_replay_worker_image_digest: imageDigest });
    expect((await sql`select stage from releases where workspace_id=${workspaceId} and id=${discoveryReleaseId}`)[0]?.stage).toBe("flow_review");
    expect(await sql`select id from evidence_manifests where workspace_id=${workspaceId} and session_id=${discoverySessionId}`).toHaveLength(1);
    expect((await sql`select status,payload from product_flow_versions where workspace_id=${workspaceId} and id=${discoveryFlowVersionId}`)[0]).toMatchObject({ status: "draft", payload: discoveredFlow });
  });
});
