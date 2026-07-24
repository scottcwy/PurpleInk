import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  InMemoryRunnerObjectStore,
  LaunchVideoRunner,
  PostgresLaunchVideoJobRepository,
} from "@purpleink/launch-video-runner";
import { evidencePackageDigest } from "../skills/product-launch-video/scripts/validation-lib.mjs";

const exec = promisify(execFile);
const container = `purpleink-video-pg-${randomUUID()}`;
const root = resolve(import.meta.dirname, "..");
const fixtureRoot = resolve(root, "packages/video-compiler/fixtures/golden-feature-launch");
const workspaceId = "00000000-0000-4000-8000-000000000001";
const productId = "10000000-0000-4000-8000-000000000001";
const releaseId = "20000000-0000-4000-8000-000000000001";
const briefVersionId = "30000000-0000-4000-8000-000000000001";
const flowId = "40000000-0000-4000-8000-000000000001";
const flowVersionId = "50000000-0000-4000-8000-000000000001";
const sessionId = "60000000-0000-4000-8000-000000000001";
const captureRunId = "61000000-0000-4000-8000-000000000001";
const evidencePackageId = "70000000-0000-4000-8000-000000000001";
const evidencePackageVersionId = "71000000-0000-4000-8000-000000000001";
const storyboardId = "80000000-0000-4000-8000-000000000001";
const storyboardVersionId = "81000000-0000-4000-8000-000000000001";
const brandKitId = "90000000-0000-4000-8000-000000000001";
const brandKitVersionId = "91000000-0000-4000-8000-000000000001";
const jobId = "a0000000-0000-4000-8000-000000000001";
let sql: postgres.Sql;

beforeAll(async () => {
  await exec("docker", ["run", "-d", "--rm", "--name", container, "-e", "POSTGRES_PASSWORD=purpleink", "-e", "POSTGRES_USER=purpleink", "-e", "POSTGRES_DB=purpleink", "-p", "127.0.0.1::5432", "postgres:16"]);
  const port = (await exec("docker", ["port", container, "5432/tcp"])).stdout.trim().split(":").at(-1);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { sql = postgres(`postgres://purpleink:purpleink@127.0.0.1:${port}/purpleink`); await sql`select 1`; break; }
    catch { await sql?.end().catch(() => undefined); await new Promise((resolveReady) => setTimeout(resolveReady, 100)); }
  }
  const migrationsUrl = new URL("../db/migrations/", import.meta.url);
  for (const file of (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql")).sort()) await sql.unsafe(await readFile(new URL(file, migrationsUrl), "utf8"));
  await sql`insert into workspaces(id,name,slug) values(${workspaceId},'Video','video')`;
  await sql`insert into products(id,workspace_id,name,canonical_url) values(${productId},${workspaceId},'Product','https://product.example.com')`;
  await sql`insert into releases(id,workspace_id,product_id,name,stage) values(${releaseId},${workspaceId},${productId},'Release','preview_queued')`;
  await sql`insert into release_brief_versions(id,workspace_id,release_id,version,schema_version,payload,content_hash,status,approved_at) values(${briefVersionId},${workspaceId},${releaseId},1,'release-brief/v1','{}',${"a".repeat(64)},'approved',now())`;
  await sql`insert into product_flows(id,workspace_id,product_id,name) values(${flowId},${workspaceId},${productId},'Flow')`;
  await sql`insert into product_flow_versions(id,workspace_id,product_flow_id,version,schema_version,payload,content_hash,status,approved_at) values(${flowVersionId},${workspaceId},${flowId},1,'product-flow/v1','{}',${"b".repeat(64)},'approved',now())`;
  await sql`insert into capture_sessions(id,workspace_id,product_id,release_id,kind,state,connectivity,allowed_origins,expires_at,hard_expires_at) values(${sessionId},${workspaceId},${productId},${releaseId},'capture','completed','disconnected','[]',now()+interval '30 minutes',now()+interval '60 minutes')`;
  await sql`insert into capture_runs(id,workspace_id,release_id,flow_version_id,capture_session_id,status,started_at,finished_at) values(${captureRunId},${workspaceId},${releaseId},${flowVersionId},${sessionId},'completed',now(),now())`;
  await sql`insert into evidence_packages(id,workspace_id,release_id) values(${evidencePackageId},${workspaceId},${releaseId})`;
  await sql`insert into evidence_package_versions(id,workspace_id,evidence_package_id,version,capture_run_id,payload,content_hash,status,approved_at) values(${evidencePackageVersionId},${workspaceId},${evidencePackageId},1,${captureRunId},'{}',${"c".repeat(64)},'approved',now())`;
  await sql`insert into storyboards(id,workspace_id,release_id) values(${storyboardId},${workspaceId},${releaseId})`;
  await sql`insert into storyboard_versions(id,workspace_id,storyboard_id,version,schema_version,payload,content_hash,status,approved_at) values(${storyboardVersionId},${workspaceId},${storyboardId},1,'storyboard/v1','{}',${"d".repeat(64)},'approved',now())`;
  await sql`insert into brand_kits(id,workspace_id,product_id) values(${brandKitId},${workspaceId},${productId})`;
  await sql`insert into brand_kit_versions(id,workspace_id,brand_kit_id,version,schema_version,payload,content_hash,status,approved_at) values(${brandKitVersionId},${workspaceId},${brandKitId},1,'brand-kit/v1','{}',${"e".repeat(64)},'approved',now())`;
  await sql`update releases set brief_version_id=${briefVersionId},product_flow_version_id=${flowVersionId},capture_run_id=${captureRunId},evidence_package_version_id=${evidencePackageVersionId},storyboard_version_id=${storyboardVersionId},brand_kit_version_id=${brandKitVersionId} where workspace_id=${workspaceId} and id=${releaseId}`;
}, 30_000);

afterAll(async () => {
  await sql?.end().catch(() => undefined);
  await exec("docker", ["rm", "-f", container]).catch(() => undefined);
});

describe("PostgreSQL LaunchVideo repository", () => {
  it("atomically publishes Plan, Bundle, RenderAttempt, Artifact, and idempotent receipt", async () => {
    const skillInput = JSON.parse(await readFile(resolve(fixtureRoot, "skill-input.json"), "utf8"));
    const plan = JSON.parse(await readFile(resolve(fixtureRoot, "plan.json"), "utf8"));
    Object.assign(skillInput, { workspaceId, productId, releaseId, releaseBriefVersionId: briefVersionId, productFlowVersionId: flowVersionId, captureRunId, evidencePackageVersionId, storyboardVersionId, brandKitVersionId });
    Object.assign(skillInput.storyboard, { id: storyboardVersionId, workspaceId, productId, releaseId });
    for (const scene of skillInput.storyboard.scenes) scene.releaseId = releaseId;
    Object.assign(skillInput.brandKit, { id: brandKitVersionId, workspaceId, productId, releaseId });
    Object.assign(skillInput.evidencePackage, { id: evidencePackageVersionId, workspaceId, productId, releaseId, captureRunId });
    skillInput.evidencePackage.provenance.flowVersionId = flowVersionId;
    for (const entry of skillInput.evidencePackage.entries) Object.assign(entry, { workspaceId, productId, releaseId });
    skillInput.evidencePackage.sha256 = evidencePackageDigest(skillInput.evidencePackage.entries);
    Object.assign(plan, { releaseId, storyboardVersionId, evidencePackageVersionId, brandKitVersionId, locale: skillInput.locale });
    const repository = new PostgresLaunchVideoJobRepository(sql);
    const runner = new LaunchVideoRunner({
      repository,
      objectStore: new InMemoryRunnerObjectStore(),
      direct: async () => plan,
      qualityGate: async ({ bundle }: { bundle: { bundleHash: string } }) => ({ report: { schemaVersion: "video-quality-report/v1", bundleHash: bundle.bundleHash, variants: { landscape: { status: "passed" } } }, previewBytes: Buffer.from("real-preview-bytes") }),
    });
    const request = { jobId, attempt: 1, workspaceId, idempotencyKey: "video-1", skillInput };
    const first = await runner.run(request);
    const duplicate = await runner.run(request);

    expect(duplicate).toEqual(first);
    expect(await sql`select id from launch_video_plans where workspace_id=${workspaceId}`).toHaveLength(1);
    expect(await sql`select id from composition_bundles where workspace_id=${workspaceId}`).toHaveLength(1);
    expect(await sql`select id from render_attempts where workspace_id=${workspaceId}`).toHaveLength(1);
    expect((await sql`select sha256,bytes,mime_type from artifacts where workspace_id=${workspaceId}`)[0]).toMatchObject({ sha256: first.preview.sha256, bytes: first.preview.bytes, mime_type: "video/mp4" });
    expect((await sql`select stage,preview_bundle_id from releases where workspace_id=${workspaceId} and id=${releaseId}`)[0]?.stage).toBe("preview_review");

    const changedInput = structuredClone(skillInput);
    changedInput.brandKit.colors.purple = "#6B2FE8";
    await expect(runner.run({ jobId, attempt: 2, workspaceId, idempotencyKey: "video-mutated-retry", skillInput: changedInput })).rejects.toThrow("immutable skill input");
    expect((await sql`select current_attempt from launch_video_jobs where workspace_id=${workspaceId} and id=${jobId}`)[0]?.current_attempt).toBe(1);
  }, 30_000);
});
