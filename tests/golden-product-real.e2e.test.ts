import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentHash } from "@purpleink/product-flow";
import {
  LaunchVideoRunner,
  PostgresLaunchVideoJobRepository,
  hyperframesQualityGate,
} from "@purpleink/launch-video-runner";
import { R2ObjectStore } from "@purpleink/r2-store";

import { PostgresCaptureControlPlane } from "@/lib/capture/control-plane";
import { authorizeCaptureTask, authorizeCaptureWorker, captureJsonRoute, issueCaptureTaskToken } from "@/lib/capture/http";
import { LaunchVideoHttpController } from "@/lib/launch-video/http";
import { PostgresReleaseCommandService } from "@/lib/releases/postgres-service";
import { evidencePackageDigest } from "../skills/product-launch-video/scripts/validation-lib.mjs";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const pgContainer = `purpleink-golden-pg-${randomUUID()}`;
const minioContainer = `purpleink-golden-r2-${randomUUID()}`;
const workerImage = "purpleink/playwright-capture-worker:golden-real";
const minioImage = "quay.io/minio/minio@sha256:54d3d6a0a58fb25b4e9943d1db3828d3b4de44666f911381b4fda57175488194";
const workspaceId = "00000000-0000-4000-8000-000000000011";
const userId = "01000000-0000-4000-8000-000000000011";
const productId = "10000000-0000-4000-8000-000000000011";
const releaseId = "20000000-0000-4000-8000-000000000011";
const briefVersionId = "21000000-0000-4000-8000-000000000011";
const flowId = "30000000-0000-4000-8000-000000000011";
const flowVersionId = "31000000-0000-4000-8000-000000000011";
const discoverySessionId = "40000000-0000-4000-8000-000000000011";
const discoveryRunId = "41000000-0000-4000-8000-000000000011";
const discoveryJobId = "42000000-0000-4000-8000-000000000011";
const captureSessionId = "50000000-0000-4000-8000-000000000011";
const captureRunId = "51000000-0000-4000-8000-000000000011";
const captureJobId = "52000000-0000-4000-8000-000000000011";
const evidencePackageId = "60000000-0000-4000-8000-000000000011";
const evidencePackageVersionId = "61000000-0000-4000-8000-000000000011";
const storyboardId = "70000000-0000-4000-8000-000000000011";
const storyboardVersionId = "71000000-0000-4000-8000-000000000011";
const brandKitId = "80000000-0000-4000-8000-000000000011";
const brandKitVersionId = "81000000-0000-4000-8000-000000000011";
const launchVideoJobId = "90000000-0000-4000-8000-000000000011";
const capabilityIds = [
  "a1000000-0000-4000-8000-000000000011",
  "a2000000-0000-4000-8000-000000000011",
  "a3000000-0000-4000-8000-000000000011",
] as const;
const nodeIds = [
  "c1000000-0000-4000-8000-000000000011",
  "c2000000-0000-4000-8000-000000000011",
  "c3000000-0000-4000-8000-000000000011",
] as const;
const sceneIds = [
  "b1000000-0000-4000-8000-000000000011",
  "b2000000-0000-4000-8000-000000000011",
  "b3000000-0000-4000-8000-000000000011",
] as const;
const externalTargetUrl = process.env.PURPLEINK_GOLDEN_TARGET_URL
  ? new URL(process.env.PURPLEINK_GOLDEN_TARGET_URL).toString()
  : undefined;
const targetName = externalTargetUrl ? "shadcn/ui" : "Golden Product";
const artifactDirectory = externalTargetUrl ? "shadcn-ui" : "golden-product";
const headlines = externalTargetUrl
  ? ["Explore shadcn/ui", "Browse the component library", "Inspect the Button component"] as const
  : ["See the product", "Create with confidence", "Finish the workflow"] as const;
const layouts = ["evidence-full", "evidence-split", "evidence-detail"] as const;
const motions = ["settle-up", "focus-push", "proof-pop"] as const;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const captureSecret = "golden-capture-bootstrap-secret-at-least-32-bytes";
const launchSecret = "golden-launch-bootstrap-secret-at-least-32-bytes";

let sql: postgres.Sql;
let store: R2ObjectStore;
let control: PostgresCaptureControlPlane;
let releases: PostgresReleaseCommandService;
let temp: string;
let server: ReturnType<typeof createServer>;
let apiServer: ReturnType<typeof createHttpServer>;
let origin: string;
let apiLocalBase: string;
let apiContainerBase: string;
let workerImageDigest: string;
let launchController: LaunchVideoHttpController | undefined;

function productHtml() {
  return `<!doctype html><html><head><style>body{font-family:Arial;background:#faf9fe;color:#12101c;padding:48px}main{max-width:900px;margin:auto}button,input{font-size:22px;padding:14px;margin:12px}h1{font-size:56px}.success{color:#008f5a;font-weight:700}</style></head><body><main><h1>Golden Product</h1><label>Project name <input aria-label="Project name"></label><button id="create">Create project</button><p id="created" class="success" hidden>Project created</p><button id="finish">Finish</button><p id="done" class="success" hidden>Workflow complete</p></main><script>document.querySelector('#create').onclick=()=>document.querySelector('#created').hidden=false;document.querySelector('#finish').onclick=()=>document.querySelector('#done').hidden=false;</script></body></html>`;
}

function flowPayload() {
  if (externalTargetUrl) {
    const targetOrigin = new URL(externalTargetUrl).origin;
    return {
      schemaVersion: "product-flow/v1", productId, startUrl: externalTargetUrl,
      allowedOrigins: [targetOrigin], viewport: { width: 1280, height: 720, deviceScaleFactor: 1 }, locale: "en-US", timezone: "UTC",
      nodes: [
        { id: nodeIds[0], order: 1, title: "Open shadcn/ui", intent: "Show the shadcn/ui home page", capabilityIds: [capabilityIds[0]], actions: [{ id: "d1000000-0000-4000-8000-000000000011", kind: "navigate", expectedUrl: externalTargetUrl, timeoutMs: 30_000, effect: "read" }], checkpoints: [{ id: "e1000000-0000-4000-8000-000000000011", kind: "visible", target: { by: "role", role: "heading", value: "The Foundation for your Design System", exact: true }, timeoutMs: 10_000 }] },
        { id: nodeIds[1], order: 2, title: "Browse components", intent: "Show the component catalog", capabilityIds: [capabilityIds[1]], actions: [{ id: "d2000000-0000-4000-8000-000000000011", kind: "navigate", expectedUrl: `${targetOrigin}/docs/components`, timeoutMs: 30_000, effect: "read" }], checkpoints: [{ id: "e2000000-0000-4000-8000-000000000011", kind: "visible", target: { by: "role", role: "heading", value: "Components", exact: true }, timeoutMs: 10_000 }] },
        { id: nodeIds[2], order: 3, title: "Inspect Button", intent: "Show the Button component", capabilityIds: [capabilityIds[2]], actions: [{ id: "d3000000-0000-4000-8000-000000000011", kind: "navigate", expectedUrl: `${targetOrigin}/docs/components/base/button`, timeoutMs: 30_000, effect: "read" }], checkpoints: [{ id: "e3000000-0000-4000-8000-000000000011", kind: "visible", target: { by: "css", value: "h1" }, timeoutMs: 10_000 }] },
      ],
      edges: [{ from: nodeIds[0], to: nodeIds[1] }, { from: nodeIds[1], to: nodeIds[2] }],
    };
  }
  return {
    schemaVersion: "product-flow/v1", productId, startUrl: origin,
    allowedOrigins: [origin], viewport: { width: 1280, height: 720, deviceScaleFactor: 1 }, locale: "en-US", timezone: "UTC",
    nodes: [
      { id: nodeIds[0], order: 1, title: "Open product", intent: "Show product", capabilityIds: [capabilityIds[0]], actions: [{ id: "d1000000-0000-4000-8000-000000000011", kind: "navigate", expectedUrl: origin, timeoutMs: 10_000, effect: "read" }], checkpoints: [{ id: "e1000000-0000-4000-8000-000000000011", kind: "visible", target: { by: "role", role: "heading", value: "Golden Product", exact: true }, timeoutMs: 5_000 }] },
      { id: nodeIds[1], order: 2, title: "Create project", intent: "Create project", capabilityIds: [capabilityIds[1]], actions: [{ id: "d2000000-0000-4000-8000-000000000011", kind: "fill", target: { by: "label", value: "Project name", exact: true }, value: { kind: "literal", value: "Launch" }, timeoutMs: 5_000, effect: "read" }, { id: "d2100000-0000-4000-8000-000000000011", kind: "click", target: { by: "role", role: "button", value: "Create project", exact: true }, timeoutMs: 5_000, effect: "idempotent_write" }], checkpoints: [{ id: "e2000000-0000-4000-8000-000000000011", kind: "visible", target: { by: "text", value: "Project created", exact: true }, timeoutMs: 5_000 }] },
      { id: nodeIds[2], order: 3, title: "Complete workflow", intent: "Show result", capabilityIds: [capabilityIds[2]], actions: [{ id: "d3000000-0000-4000-8000-000000000011", kind: "click", target: { by: "role", role: "button", value: "Finish", exact: true }, timeoutMs: 5_000, effect: "idempotent_write" }], checkpoints: [{ id: "e3000000-0000-4000-8000-000000000011", kind: "visible", target: { by: "text", value: "Workflow complete", exact: true }, timeoutMs: 5_000 }] },
    ],
    edges: [{ from: nodeIds[0], to: nodeIds[1] }, { from: nodeIds[1], to: nodeIds[2] }],
  };
}

async function dispatchCapture(request: Request, path: string): Promise<Response> {
  return captureJsonRoute(request, async (body) => {
    if (path === "/api/internal/capture/jobs") {
      authorizeCaptureWorker(request, captureSecret);
      const jobId = String(body.id);
      const workspace = String(body.workspaceId);
      const attempt = Number(body.attempt);
      const result = await control.createAttempt({
        id: jobId, workspaceId: workspace, captureSessionId: String(body.captureSessionId),
        attempt, imageDigest: String(body.imageDigest), region: String(body.region), payload: body.payload ?? {},
      });
      return { ...result, workloadToken: issueCaptureTaskToken(captureSecret, { workspaceId: workspace, jobId, attempt, expiresAt: Date.now() + 65 * 60_000 }) };
    }
    const match = path.match(/^\/api\/internal\/capture\/jobs\/([^/]+)\/(lease|heartbeat|events|uploads\/sign|callback)$/);
    if (!match) throw new Error(`unknown capture route ${path}`);
    const jobId = decodeURIComponent(match[1]!);
    const action = match[2]!;
    const scope = { workspaceId: String(body.workspaceId), jobId, attempt: Number(body.attempt) };
    authorizeCaptureTask(request, captureSecret, scope);
    const common = { ...scope, leaseToken: String(body.leaseToken) };
    if (action === "lease") return control.lease({ ...scope, ttlMs: Number(body.ttlMs) });
    if (action === "heartbeat") return control.heartbeat(common);
    if (action === "events") {
      const results = [];
      for (const event of Array.isArray(body.events) ? body.events : []) {
        const value = event as Record<string, unknown>;
        results.push(await control.appendEvent({ ...common, seq: Number(value.seq), eventType: String(value.eventType), payload: value.payload ?? {} }));
      }
      return { events: results };
    }
    if (action === "uploads/sign") {
      const entries = Array.isArray(body.entries) ? body.entries : [];
      return { uploads: await control.signUploads({ ...common, entries: entries.map((entry) => {
        const value = entry as Record<string, unknown>;
        return { r2Key: String(value.r2Key), mimeType: String(value.mimeType), bytes: Number(value.bytes), sha256: String(value.sha256), redactionStatus: String(value.redactionStatus) as "passed" | "blocked" | "needs_review" };
      }) }) };
    }
    if (body.status === "completed") return control.completeAttempt({ ...common, manifest: body.manifest as never });
    return control.fail({ ...common, errorCode: String(body.errorCode), ...(typeof body.diagnostic === "string" ? { diagnostic: body.diagnostic } : {}) });
  });
}

async function runWorker(input: { kind: "discovery" | "capture"; sessionId: string; jobId: string; runId: string }) {
  const directory = await mkdtemp(join(temp, "worker-"));
  const inputDir = join(directory, "input");
  const outputDir = join(directory, "output");
  await mkdir(inputDir); await mkdir(outputDir);
  const payload = { schemaVersion: "capture-worker-job/v1", kind: input.kind, workspaceId, captureSessionId: input.sessionId, jobId: input.jobId, attempt: 1, runId: input.runId, flowVersionId, imageDigest: workerImageDigest, ignoreHttpsErrors: true, flow: flowPayload() };
  const created = await fetch(`${apiLocalBase}/api/internal/capture/jobs`, { method: "POST", headers: { authorization: `Bearer ${captureSecret}`, "content-type": "application/json" }, body: JSON.stringify({ id: input.jobId, workspaceId, captureSessionId: input.sessionId, attempt: 1, imageDigest: workerImageDigest, region: "test", payload }) });
  if (!created.ok) throw new Error(`capture job bootstrap failed: ${created.status} ${await created.text()}`);
  const task = await created.json();
  const job = { workspaceId, jobId: input.jobId, attempt: 1, controlPlaneUrl: `${apiContainerBase}/api/internal/capture`, workloadToken: task.workloadToken };
  await writeFile(join(inputDir, "job.json"), JSON.stringify(job));
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn("docker", ["run", "--rm", "--platform=linux/amd64", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m", "--pids-limit=256", "--memory=1g", "--cpus=1", "--add-host=host.docker.internal:host-gateway", "-e", "PURPLEINK_CAPTURE_ALLOW_PRIVATE_TEST_ORIGINS=1", "-v", `${inputDir}:/input:ro`, "-v", `${outputDir}:/output`, workerImage, "/input/job.json", "/output"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => code === 0 ? resolveRun() : reject(new Error(stderr)));
  });
  return { outputDir, manifest: JSON.parse(await readFile(join(outputDir, "manifest.json"), "utf8")) };
}

beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), "purpleink-golden-real-"));
  const cert = join(temp, "cert.pem"); const key = join(temp, "key.pem");
  await exec("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=host.docker.internal", "-keyout", key, "-out", cert]);
  server = createServer({ key: await readFile(key), cert: await readFile(cert) }, (_request, response) => { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(productHtml()); });
  await new Promise<void>((resolveListen) => server.listen(0, "0.0.0.0", resolveListen));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("HTTPS server did not bind");
  origin = externalTargetUrl ?? `https://host.docker.internal:${address.port}`;
  await Promise.all([
    exec("docker", ["run", "-d", "--rm", "--name", pgContainer, "-e", "POSTGRES_PASSWORD=purpleink", "-e", "POSTGRES_USER=purpleink", "-e", "POSTGRES_DB=purpleink", "-p", "127.0.0.1::5432", "postgres:16"]),
    exec("docker", ["run", "-d", "--rm", "--name", minioContainer, "-e", "MINIO_ROOT_USER=purpleinktest", "-e", "MINIO_ROOT_PASSWORD=purpleinktestsecret", "-p", "127.0.0.1::9000", minioImage, "server", "/data"]),
    exec("docker", ["build", "--platform=linux/amd64", "-f", "packages/playwright-capture-worker/Dockerfile", "-t", workerImage, "."], { cwd: root, maxBuffer: 10_000_000 }),
  ]);
  workerImageDigest = (await exec("docker", ["image", "inspect", workerImage, "--format", "{{.Id}}"])).stdout.trim();
  const pgPort = (await exec("docker", ["port", pgContainer, "5432/tcp"])).stdout.trim().split(":").at(-1);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { sql = postgres(`postgres://purpleink:purpleink@127.0.0.1:${pgPort}/purpleink`); await sql`select 1`; break; }
    catch { await sql?.end().catch(() => undefined); await new Promise((ready) => setTimeout(ready, 100)); }
  }
  const migrationsUrl = new URL("../db/migrations/", import.meta.url);
  for (const file of (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql")).sort()) await sql.unsafe(await readFile(new URL(file, migrationsUrl), "utf8"));
  const minioPort = (await exec("docker", ["port", minioContainer, "9000/tcp"])).stdout.trim().split(":").at(-1);
  const endpoint = `http://127.0.0.1:${minioPort}`;
  for (let attempt = 0; attempt < 50; attempt += 1) { try { if ((await fetch(`${endpoint}/minio/health/live`)).ok) break; } catch {} await new Promise((ready) => setTimeout(ready, 100)); }
  store = new R2ObjectStore({ endpoint, region: "us-east-1", bucket: "golden", accessKeyId: "purpleinktest", secretAccessKey: "purpleinktestsecret" });
  await store.createBucket();
  const containerStore = new R2ObjectStore({ endpoint: `http://host.docker.internal:${minioPort}`, region: "us-east-1", bucket: "golden", accessKeyId: "purpleinktest", secretAccessKey: "purpleinktestsecret" });
  control = new PostgresCaptureControlPlane(sql, {
    signPut: (input) => containerStore.signPut(input),
    head: (key) => store.head(key),
  });
  releases = new PostgresReleaseCommandService(sql, store);
  apiServer = createHttpServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const path = new URL(incoming.url ?? "/", "http://127.0.0.1").pathname;
      const request = new Request(`http://127.0.0.1${path}`, {
        method: incoming.method ?? "GET",
        headers: incoming.headers as HeadersInit,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      let response: Response;
      if (path.startsWith("/api/internal/capture/")) {
        response = await dispatchCapture(request, path);
      } else {
        if (!launchController) throw new Error("launch controller is not ready");
        const execute = path.match(/^\/api\/internal\/launch-video\/jobs\/([^/]+)\/execute$/);
        const callback = path.match(/^\/api\/internal\/launch-video\/jobs\/([^/]+)\/callback$/);
        if (path === "/api/internal/launch-video/jobs") response = await launchController.create(request);
        else if (execute) response = await launchController.execute(request, decodeURIComponent(execute[1]!));
        else if (callback) response = await launchController.callback(request, decodeURIComponent(callback[1]!));
        else response = Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.writeHead(500, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise<void>((resolveListen) => apiServer.listen(0, "0.0.0.0", resolveListen));
  const apiAddress = apiServer.address();
  if (!apiAddress || typeof apiAddress === "string") throw new Error("control-plane server did not bind");
  apiLocalBase = `http://127.0.0.1:${apiAddress.port}`;
  apiContainerBase = `http://host.docker.internal:${apiAddress.port}`;
}, 300_000);

afterAll(async () => {
  await sql?.end().catch(() => undefined);
  await Promise.all([exec("docker", ["rm", "-f", pgContainer]).catch(() => undefined), exec("docker", ["rm", "-f", minioContainer]).catch(() => undefined)]);
  await new Promise<void>((resolveClose) => server?.close(() => resolveClose()));
  await new Promise<void>((resolveClose) => apiServer?.close(() => resolveClose()));
  if (temp) await rm(temp, { recursive: true, force: true });
});
describe("Golden Product real vertical pipeline", () => {
  it("publishes a provenance-locked 16:9 MP4 from real Linux Playwright evidence", async () => {
    if (process.env.PURPLEINK_GOLDEN_TARGET_URL) {
      expect(flowPayload().startUrl).toBe(new URL(process.env.PURPLEINK_GOLDEN_TARGET_URL).toString());
    }
    const briefPayload = { audience: "Product teams", message: "Complete work visibly", proofPoints: ["Real browser capture"], cta: "Start now" };
    const brandKit = { colors: { paper: "#FAF9FE", ink: "#12101C", purple: "#7D3DF3", proof: "#00C37A" }, fonts: { display: "Arial", body: "Arial", mono: "Courier New" } };
    await sql`insert into workspaces(id,name,slug) values(${workspaceId},'Golden','golden-real')`;
    await sql`insert into users(id,email,name) values(${userId},'golden@example.com','Golden Owner')`;
    await sql`insert into memberships(workspace_id,user_id,role) values(${workspaceId},${userId},'owner')`;
    await sql`insert into products(id,workspace_id,name,canonical_url) values(${productId},${workspaceId},${targetName},${origin})`;
    await sql`insert into releases(id,workspace_id,product_id,name) values(${releaseId},${workspaceId},${productId},'Golden release')`;
    await sql`insert into release_brief_versions(id,workspace_id,release_id,version,schema_version,payload,content_hash) values(${briefVersionId},${workspaceId},${releaseId},1,'release-brief/v1',${sql.json(briefPayload)},${await contentHash(briefPayload)})`;
    await sql`insert into brand_kits(id,workspace_id,product_id) values(${brandKitId},${workspaceId},${productId})`;
    await sql`insert into brand_kit_versions(id,workspace_id,brand_kit_id,version,schema_version,payload,content_hash,status,approved_at) values(${brandKitVersionId},${workspaceId},${brandKitId},1,'brand-kit/v1',${sql.json(brandKit)},${await contentHash(brandKit)},'approved',now())`;
    for (const [index, capabilityId] of capabilityIds.entries()) await sql`insert into product_capabilities(id,workspace_id,product_id,name,description) values(${capabilityId},${workspaceId},${productId},${`Capability ${index + 1}`},'Verified browser behavior')`;
    await releases.approveBrief({ workspaceId, releaseId, candidateId: briefVersionId, expectedRevision: 1, idempotencyKey: "golden-brief", actorId: userId });

    await sql`insert into product_flows(id,workspace_id,product_id,name) values(${flowId},${workspaceId},${productId},'Golden flow')`;
    await releases.startDiscovery({ workspaceId, releaseId, productFlowId: flowId, captureSessionId: discoverySessionId, discoveryRunId, expectedRevision: 2, idempotencyKey: "golden-start-discovery", actorId: userId, allowedOrigins: flowPayload().allowedOrigins });
    await runWorker({ kind: "discovery", sessionId: discoverySessionId, jobId: discoveryJobId, runId: discoveryRunId });
    await releases.approveFlow({ workspaceId, releaseId, candidateId: flowVersionId, discoveryRunId, expectedRevision: 4, idempotencyKey: "golden-flow", actorId: userId });

    await releases.startCapture({ workspaceId, releaseId, captureSessionId, captureRunId, expectedRevision: 5, idempotencyKey: "golden-start-capture", actorId: userId, allowedOrigins: flowPayload().allowedOrigins });
    const captureOutput = await runWorker({ kind: "capture", sessionId: captureSessionId, jobId: captureJobId, runId: captureRunId });
    const [captureReceipt] = await sql`select manifest_hash from capture_sessions where workspace_id=${workspaceId} and id=${captureSessionId}`;
    const capturedEvidence = await sql`select ne.id from node_evidence ne join node_executions nx on nx.workspace_id=ne.workspace_id and nx.id=ne.node_execution_id where ne.workspace_id=${workspaceId} and nx.capture_run_id=${captureRunId} order by ne.id`;
    const captureCompleted = { manifestHash: String(captureReceipt?.manifest_hash), nodeEvidenceIds: capturedEvidence.map((row) => String(row.id)) };
    expect(captureCompleted.manifestHash).toBe(await contentHash(captureOutput.manifest));

    let revision = 7;
    for (const nodeEvidenceId of captureCompleted.nodeEvidenceIds) {
      const approved = await releases.approveNodeEvidence({ workspaceId, releaseId, nodeEvidenceId, expectedRevision: revision, idempotencyKey: `golden-evidence-${nodeEvidenceId}`, actorId: userId });
      revision = approved.release.revision;
    }
    const screenshotRows = await sql`
      select ne.id as node_evidence_id,ne.asset_version_id,ne.manifest,av.r2_key,
        av.sha256,av.bytes,av.mime_type
      from node_evidence ne
      join asset_versions av on av.workspace_id=ne.workspace_id and av.id=ne.asset_version_id
      where ne.workspace_id=${workspaceId} and ne.kind='result_screenshot'
      order by ne.created_at
    `;
    expect(screenshotRows).toHaveLength(3);
    const refs = screenshotRows.map((row) => ({ kind: "node_evidence", nodeEvidenceId: row.node_evidence_id as string, assetVersionId: row.asset_version_id as string }));
    const packagePayload = { schemaVersion: "evidence-package/v1", releaseId, captureRunId, refs, provenance: { flowVersionId, manifestHash: captureCompleted.manifestHash, workerImageDigest } };
    await sql`insert into evidence_packages(id,workspace_id,release_id) values(${evidencePackageId},${workspaceId},${releaseId})`;
    await sql`insert into evidence_package_versions(id,workspace_id,evidence_package_id,version,capture_run_id,payload,content_hash) values(${evidencePackageVersionId},${workspaceId},${evidencePackageId},1,${captureRunId},${sql.json(packagePayload)},${await contentHash(packagePayload)})`;
    const evidenceApproved = await releases.approveEvidence({ workspaceId, releaseId, candidateId: evidencePackageVersionId, brandKitVersionId, expectedRevision: revision, idempotencyKey: "golden-package", actorId: userId });
    revision = evidenceApproved.release.revision;

    const storyboardPayload = { schemaVersion: "storyboard/v1", releaseId, evidencePackageVersionId, scenes: refs.map((ref, index) => ({ id: sceneIds[index]!, order: index + 1, capabilityId: capabilityIds[index]!, claimType: "browser_behavior", headline: headlines[index]!, body: "Captured and verified in a real browser.", evidence: [ref] })) };
    await sql`insert into storyboards(id,workspace_id,release_id) values(${storyboardId},${workspaceId},${releaseId})`;
    await sql`insert into storyboard_versions(id,workspace_id,storyboard_id,version,schema_version,payload,content_hash) values(${storyboardVersionId},${workspaceId},${storyboardId},1,'storyboard/v1',${sql.json(storyboardPayload)},${await contentHash(storyboardPayload)})`;
    const generated = await releases.storyboardGenerated({ workspaceId, releaseId, candidateId: storyboardVersionId, expectedRevision: revision, idempotencyKey: "golden-storyboard-generated", actorId: userId });
    const storyboardApproved = await releases.approveStoryboard({ workspaceId, releaseId, candidateId: storyboardVersionId, expectedRevision: generated.release.revision, idempotencyKey: "golden-storyboard-approved", actorId: userId });
    expect(storyboardApproved.release.stage).toBe("preview_queued");

    const evidenceEntries = [];
    for (let index = 0; index < screenshotRows.length; index += 1) {
      const row = screenshotRows[index];
      if (!row) throw new Error(`missing screenshot row ${index}`);
      const bytes = await store.get(row.r2_key as string);
      if (!bytes) throw new Error(`missing R2 evidence ${row.r2_key}`);
      evidenceEntries.push({ ref: refs[index]!, assetVersionId: row.asset_version_id, sceneIds: [sceneIds[index]!], workspaceId, productId, releaseId, approvalStatus: "approved", redactionStatus: "passed", immutable: true, assetKind: "result_screenshot", mimeType: row.mime_type, bytes: row.bytes, sha256: row.sha256, bundlePath: `assets/${nodeIds[index]!}.png`, contentBase64: bytes.toString("base64") });
    }
    const skillInput = {
      schemaVersion: "launch-video-skill-input/v1", workspaceId, productId, releaseId,
      releaseBriefVersionId: briefVersionId, storyboardVersionId, productFlowVersionId: flowVersionId,
      captureRunId, brandKitVersionId, evidencePackageVersionId, templateVersion: "feature-launch@1.0.0",
      locale: "en-US", targetDurationMs: 18_000,
      storyboard: { id: storyboardVersionId, workspaceId, productId, releaseId, approvalStatus: "approved", immutable: true, scenes: sceneIds.map((id, index) => ({ id, order: index + 1, releaseId, capabilityId: capabilityIds[index]!, claimType: "browser_behavior", headline: headlines[index]!, body: "Captured and verified in a real browser.", evidence: [refs[index]!] })) },
      brandKit: { id: brandKitVersionId, workspaceId, productId, releaseId, approvalStatus: "approved", immutable: true, ...brandKit },
      evidencePackage: { schemaVersion: "evidence-package/v1", id: evidencePackageVersionId, workspaceId, productId, releaseId, captureRunId, approvalStatus: "approved", immutable: true, refs, provenance: packagePayload.provenance, sha256: evidencePackageDigest(evidenceEntries), entries: evidenceEntries },
      templateCapabilities: { templateVersion: "feature-launch@1.0.0", layoutIds: ["evidence-full", "evidence-split", "evidence-detail"], motionPresetIds: ["settle-up", "focus-push", "proof-pop"], transitionIds: ["continuity-cut", "soft-wipe"], copyLimits: { headlineMaxChars: 54, bodyMaxChars: 110 } },
    };
    const plan = { schemaVersion: "launch-video-plan/v1", releaseId, storyboardVersionId, evidencePackageVersionId, brandKitVersionId, templateVersion: "feature-launch@1.0.0", locale: "en-US", durationMs: 18_000, beats: sceneIds.map((sceneId, index) => ({ id: `beat-${index + 1}`, sceneId, capabilityId: capabilityIds[index]!, startMs: index * 6_000, durationMs: 6_000, layoutId: layouts[index]!, motionPresetId: motions[index]!, transitionId: index === 1 ? "continuity-cut" : "soft-wipe", headline: headlines[index]!, body: "Captured and verified in a real browser.", evidence: [refs[index]!] })) };
    const runner = new LaunchVideoRunner({ repository: new PostgresLaunchVideoJobRepository(sql), objectStore: store, direct: async () => plan, qualityGate: hyperframesQualityGate });
    launchController = new LaunchVideoHttpController({ runner, secret: launchSecret });
    const launchRequest = { jobId: launchVideoJobId, attempt: 1, workspaceId, idempotencyKey: "golden-video", skillInput };
    const launchBootstrapResponse = await fetch(`${apiLocalBase}/api/internal/launch-video/jobs`, { method: "POST", headers: { authorization: `Bearer ${launchSecret}`, "content-type": "application/json" }, body: JSON.stringify(launchRequest) });
    expect(launchBootstrapResponse.ok).toBe(true);
    const launchBootstrap = await launchBootstrapResponse.json();
    const launchResponse = await fetch(`${apiLocalBase}/api/internal/launch-video/jobs/${launchVideoJobId}/execute`, { method: "POST", headers: { authorization: `Bearer ${launchBootstrap.workloadToken}`, "content-type": "application/json" }, body: JSON.stringify(launchRequest) });
    if (!launchResponse.ok) throw new Error(`launch video HTTP execution failed: ${launchResponse.status} ${await launchResponse.text()}`);
    const video = await launchResponse.json();
    const previewBytes = await store.get(video.preview.r2Key);
    expect(previewBytes).not.toBeNull();
    expect(digest(previewBytes as Buffer)).toBe(video.preview.sha256);
    const outputPath = resolve(root, `.artifacts/${artifactDirectory}/preview-landscape.mp4`);
    await mkdir(resolve(root, `.artifacts/${artifactDirectory}`), { recursive: true });
    await writeFile(outputPath, previewBytes as Buffer);
    const probe = JSON.parse((await exec("ffprobe", ["-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "json", outputPath])).stdout);
    expect(probe.streams[0]).toMatchObject({ width: 1920, height: 1080 });
    expect(Math.round(Number(probe.format.duration) * 1000)).toBe(18_000);
    const artifact = (await sql`select a.sha256,a.bytes,a.metadata from artifacts a where a.workspace_id=${workspaceId}`)[0];
    expect(artifact).toMatchObject({ sha256: video.preview.sha256, bytes: video.preview.bytes });
    expect(artifact?.metadata).toMatchObject({ bundleHash: video.bundle.bundleHash, width: 1920, height: 1080, durationMs: 18_000 });
    const provenance = (await sql`
      select a.id as artifact_id,a.r2_key,a.sha256,a.bytes,
        cb.id as bundle_id,cb.bundle_hash,cb.plan_hash,cb.evidence_package_version_id,
        lvp.id as plan_id,lvp.storyboard_version_id,lvp.brand_kit_version_id,
        epv.capture_run_id,epv.status as evidence_status,cr.flow_version_id,
        count(ne.id)::integer as evidence_count,
        bool_and(ne.approved_at is not null) as all_evidence_approved
      from artifacts a
      join render_jobs rj on rj.workspace_id=a.workspace_id and rj.id=a.render_job_id
      join composition_bundles cb on cb.workspace_id=rj.workspace_id and cb.id=rj.bundle_id
      join launch_video_plans lvp on lvp.workspace_id=cb.workspace_id and lvp.id=cb.launch_video_plan_id
      join evidence_package_versions epv on epv.workspace_id=cb.workspace_id and epv.id=cb.evidence_package_version_id
      join capture_runs cr on cr.workspace_id=epv.workspace_id and cr.id=epv.capture_run_id
      cross join lateral jsonb_array_elements(epv.payload->'refs') as ref
      join node_evidence ne on ne.workspace_id=epv.workspace_id and ne.id=(ref->>'nodeEvidenceId')::uuid
      where a.workspace_id=${workspaceId} and a.sha256=${video.preview.sha256}
      group by a.id,a.r2_key,a.sha256,a.bytes,cb.id,cb.bundle_hash,cb.plan_hash,
        cb.evidence_package_version_id,lvp.id,lvp.storyboard_version_id,lvp.brand_kit_version_id,
        epv.capture_run_id,epv.status,cr.flow_version_id
    `)[0];
    expect(provenance).toMatchObject({
      r2_key: video.preview.r2Key,
      sha256: video.preview.sha256,
      bytes: video.preview.bytes,
      bundle_hash: video.bundle.bundleHash,
      evidence_package_version_id: evidencePackageVersionId,
      storyboard_version_id: storyboardVersionId,
      brand_kit_version_id: brandKitVersionId,
      capture_run_id: captureRunId,
      flow_version_id: flowVersionId,
      evidence_status: "approved",
      evidence_count: 3,
      all_evidence_approved: true,
    });
    await writeFile(resolve(root, `.artifacts/${artifactDirectory}/provenance.json`), `${JSON.stringify({
      schemaVersion: "golden-preview-provenance/v1",
      workspaceId,
      productId,
      releaseId,
      artifact: provenance,
      evidenceRefs: refs,
      captureManifestHash: captureCompleted.manifestHash,
      workerImageDigest,
    }, null, 2)}\n`);
    expect((await releases.getRelease(workspaceId, releaseId)).stage).toBe("preview_review");
  }, 900_000);
});
