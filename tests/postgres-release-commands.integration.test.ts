import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import postgres from "postgres";
import { contentHash } from "@purpleink/product-flow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PostgresReleaseCommandService,
} from "@/lib/releases/postgres-service";

const exec = promisify(execFile);
const container = `purpleink-postgres-${randomUUID()}`;
const workspaceA = "00000000-0000-4000-8000-000000000001";
const workspaceB = "00000000-0000-4000-8000-000000000002";
const userId = "10000000-0000-4000-8000-000000000001";
const productId = "20000000-0000-4000-8000-000000000001";
const releaseId = "30000000-0000-4000-8000-000000000001";
const briefId = "40000000-0000-4000-8000-000000000001";
const successorBriefId = "40000000-0000-4000-8000-000000000002";
const briefPayload = { audience: "Founders", message: "Ship faster", proofPoints: ["Real capture"], cta: "Try it" };
const productFlowId = "50000000-0000-4000-8000-000000000001";
const flowVersionId = "60000000-0000-4000-8000-000000000001";
const successorFlowVersionId = "60000000-0000-4000-8000-000000000002";
const discoverySessionId = "61000000-0000-4000-8000-000000000001";
const discoveryWorkerJobId = "62000000-0000-4000-8000-000000000001";
const discoveryRunId = "63000000-0000-4000-8000-000000000001";
const captureSessionId = "80000000-0000-4000-8000-000000000001";
const captureWorkerJobId = "80500000-0000-4000-8000-000000000001";
const captureRunId = "81000000-0000-4000-8000-000000000001";
const nodeExecutionId = "82000000-0000-4000-8000-000000000001";
const sourceAssetId = "83000000-0000-4000-8000-000000000001";
const assetVersionId = "84000000-0000-4000-8000-000000000001";
const nodeEvidenceId = "85000000-0000-4000-8000-000000000001";
const evidencePackageId = "86000000-0000-4000-8000-000000000001";
const evidencePackageVersionId = "87000000-0000-4000-8000-000000000001";
const successorEvidencePackageVersionId = "87000000-0000-4000-8000-000000000002";
const brandKitId = "88000000-0000-4000-8000-000000000001";
const brandKitVersionId = "89000000-0000-4000-8000-000000000001";
const successorBrandKitVersionId = "89000000-0000-4000-8000-000000000002";
const storyboardId = "92000000-0000-4000-8000-000000000001";
const storyboardVersionId = "93000000-0000-4000-8000-000000000001";
const successorStoryboardVersionId = "93000000-0000-4000-8000-000000000002";
const staleBundleId = "94000000-0000-4000-8000-000000000001";
const staleRenderJobId = "95000000-0000-4000-8000-000000000001";
let sql: postgres.Sql;
let service: PostgresReleaseCommandService;
let approvalHead: { bytes: number; sha256: string; mimeType: string } | null = null;

beforeAll(async () => {
  await exec("docker", [
    "run", "-d", "--rm", "--name", container,
    "-e", "POSTGRES_PASSWORD=purpleink",
    "-e", "POSTGRES_USER=purpleink",
    "-e", "POSTGRES_DB=purpleink",
    "-p", "127.0.0.1::5432", "postgres:16",
  ]);
  const port = (await exec("docker", ["port", container, "5432/tcp"])).stdout.trim().split(":").at(-1);
  const url = `postgres://purpleink:purpleink@127.0.0.1:${port}/purpleink`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      sql = postgres(url, { max: 4 });
      await sql`select 1`;
      break;
    } catch {
      await sql?.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!sql) throw new Error("PostgreSQL did not become ready");
  const migrationsUrl = new URL("../db/migrations/", import.meta.url);
  for (const file of (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql")).sort()) {
    await sql.unsafe(await readFile(new URL(file, migrationsUrl), "utf8"));
  }
  await sql`insert into workspaces (id,name,slug) values
    (${workspaceA},'A','a'),(${workspaceB},'B','b')`;
  await sql`insert into users (id,email,name) values (${userId},'owner@example.com','Owner')`;
  await sql`insert into memberships (workspace_id,user_id,role) values (${workspaceA},${userId},'owner')`;
  await sql`insert into products (id,workspace_id,name,canonical_url) values
    (${productId},${workspaceA},'Product A','https://a.example.com'),
    (${productId},${workspaceB},'Product B','https://b.example.com')`;
  await sql`insert into releases (id,workspace_id,product_id,name) values
    (${releaseId},${workspaceA},${productId},'Release A'),
    (${releaseId},${workspaceB},${productId},'Release B')`;
  const briefHash = await contentHash(briefPayload);
  await sql`insert into release_brief_versions (
      id,workspace_id,release_id,version,schema_version,payload,content_hash
    ) values (
      ${briefId},${workspaceA},${releaseId},1,'release-brief/v1',
      ${sql.json(briefPayload)},
      ${briefHash}
    )`;
  service = new PostgresReleaseCommandService(sql, {
    head: async () => approvalHead,
  });
}, 30_000);

afterAll(async () => {
  await sql?.end().catch(() => undefined);
  await exec("docker", ["rm", "-f", container]).catch(() => undefined);
});

describe("PostgreSQL atomic release commands", () => {
  it("atomically approves and pins a candidate with one idempotent result", async () => {
    const input = {
      workspaceId: workspaceA,
      releaseId,
      candidateId: briefId,
      expectedRevision: 1,
      idempotencyKey: "approve-brief-1",
      actorId: userId,
    };
    const first = await service.approveBrief(input);
    const duplicate = await service.approveBrief(input);

    expect(duplicate).toEqual(first);
    expect(first.release).toMatchObject({
      workspaceId: workspaceA,
      id: releaseId,
      stage: "flow_selecting",
      revision: 2,
      refs: { briefVersionId: briefId },
    });
    const [brief] = await sql`select status,approved_at from release_brief_versions where workspace_id=${workspaceA} and id=${briefId}`;
    expect(brief?.status).toBe("approved");
    expect(await sql`select id from approvals where workspace_id=${workspaceA} and release_id=${releaseId}`).toHaveLength(1);
    expect(await sql`select id from command_receipts where workspace_id=${workspaceA} and idempotency_key='approve-brief-1'`).toHaveLength(1);
    expect(await sql`select id from audit_events where workspace_id=${workspaceA} and event_type='release_brief.approved'`).toHaveLength(1);
  });

  it("rejects a stale revision and never crosses workspace scope", async () => {
    await expect(service.approveBrief({
      workspaceId: workspaceA,
      releaseId,
      candidateId: briefId,
      expectedRevision: 1,
      idempotencyKey: "stale-brief",
      actorId: userId,
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });

    const other = await service.getRelease(workspaceB, releaseId);
    expect(other).toMatchObject({ workspaceId: workspaceB, refs: {} });
    await expect(service.getRelease("00000000-0000-4000-8000-000000000099", releaseId)).rejects.toMatchObject({ code: "RELEASE_NOT_FOUND" });
  });

  it("atomically approves a clean-replayed ProductFlow candidate", async () => {
    const flowPayload = {
      schemaVersion: "product-flow/v1",
      productId,
      startUrl: "https://a.example.com",
      allowedOrigins: ["https://a.example.com"],
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      locale: "en-US",
      timezone: "UTC",
      nodes: [1, 2, 3].map((order) => ({
        id: `70000000-0000-4000-8000-00000000000${order}`,
        order,
        title: `Node ${order}`,
        intent: `Prove ${order}`,
        capabilityIds: [],
        actions: [{ id: `71000000-0000-4000-8000-00000000000${order}`, kind: "navigate", expectedUrl: "https://a.example.com", timeoutMs: 5_000, effect: "read" }],
        checkpoints: [{ id: `72000000-0000-4000-8000-00000000000${order}`, kind: "url_matches", expected: "a\\.example\\.com", timeoutMs: 5_000 }],
      })),
      edges: [
        { from: "70000000-0000-4000-8000-000000000001", to: "70000000-0000-4000-8000-000000000002" },
        { from: "70000000-0000-4000-8000-000000000002", to: "70000000-0000-4000-8000-000000000003" },
      ],
    };
    await sql`insert into product_flows(id,workspace_id,product_id,name) values(${productFlowId},${workspaceA},${productId},'Golden flow')`;
    await sql`insert into product_flow_versions(id,workspace_id,product_flow_id,version,schema_version,payload,content_hash) values(${flowVersionId},${workspaceA},${productFlowId},1,'product-flow/v1',${sql.json(flowPayload)},${await contentHash(flowPayload)})`;
    const started = await service.startDiscovery({ workspaceId: workspaceA, releaseId, productFlowId, captureSessionId: discoverySessionId, discoveryRunId, expectedRevision: 2, idempotencyKey: "start-discovery-1", actorId: userId, allowedOrigins: ["https://a.example.com"] });
    expect(started.release).toMatchObject({ stage: "flow_discovering", revision: 3 });
    await sql`update capture_sessions set state='completed',manifest_hash=${"e".repeat(64)},current_attempt=1 where workspace_id=${workspaceA} and id=${discoverySessionId}`;
    await sql`insert into capture_worker_jobs(id,workspace_id,capture_session_id,attempt,image_digest,region,status,started_at,finished_at) values(${discoveryWorkerJobId},${workspaceA},${discoverySessionId},1,${"sha256:ffc33305f7b4b04057ae4a0caa70aad4fde87454fb403a1a22e7f931707dfcf9"},'test','completed',now(),now())`;
    await sql`update capture_sessions set current_job_id=${discoveryWorkerJobId} where workspace_id=${workspaceA} and id=${discoverySessionId}`;
    await sql`update discovery_runs set status='completed',proposed_version_id=${flowVersionId},clean_replay_manifest_hash=${"e".repeat(64)},clean_replay_worker_image_digest=${"sha256:ffc33305f7b4b04057ae4a0caa70aad4fde87454fb403a1a22e7f931707dfcf9"},clean_replay_passed_at=now() where workspace_id=${workspaceA} and id=${discoveryRunId}`;
    await sql`update releases set stage='flow_review',revision=4 where workspace_id=${workspaceA} and id=${releaseId}`;

    const result = await service.approveFlow({
      workspaceId: workspaceA,
      releaseId,
      candidateId: flowVersionId,
      expectedRevision: 4,
      idempotencyKey: "approve-flow-1",
      actorId: userId,
      discoveryRunId,
    });

    expect(result.release).toMatchObject({
      stage: "capture_pending",
      revision: 5,
      refs: { productFlowVersionId: flowVersionId },
    });
    expect((await sql`select status from product_flow_versions where workspace_id=${workspaceA} and id=${flowVersionId}`)[0]?.status).toBe("approved");
  });

  it("freezes EvidencePackageVersion and pins its approved BrandKit atomically", async () => {
    const started = await service.startCapture({ workspaceId: workspaceA, releaseId, captureSessionId, captureRunId, expectedRevision: 5, idempotencyKey: "start-capture-1", actorId: userId, allowedOrigins: ["https://a.example.com"] });
    expect(started.release).toMatchObject({ stage: "capturing", revision: 6 });
    await sql`update capture_sessions set state='completed',manifest_hash=${"c".repeat(64)},current_attempt=1 where workspace_id=${workspaceA} and id=${captureSessionId}`;
    await sql`insert into capture_worker_jobs(id,workspace_id,capture_session_id,attempt,image_digest,region,status,started_at,finished_at) values(${captureWorkerJobId},${workspaceA},${captureSessionId},1,${"sha256:ffc33305f7b4b04057ae4a0caa70aad4fde87454fb403a1a22e7f931707dfcf9"},'test','completed',now(),now())`;
    await sql`update capture_sessions set current_job_id=${captureWorkerJobId} where workspace_id=${workspaceA} and id=${captureSessionId}`;
    await sql`update capture_runs set status='completed',started_at=now(),finished_at=now() where workspace_id=${workspaceA} and id=${captureRunId}`;
    await sql`insert into node_executions(id,workspace_id,capture_run_id,node_id,status,started_at,finished_at) values(${nodeExecutionId},${workspaceA},${captureRunId},'70000000-0000-4000-8000-000000000003','passed',now(),now())`;
    await sql`insert into source_assets(id,workspace_id,product_id,kind) values(${sourceAssetId},${workspaceA},${productId},'node_evidence')`;
    await sql`insert into asset_versions(id,workspace_id,source_asset_id,r2_key,sha256,bytes,mime_type,metadata) values(${assetVersionId},${workspaceA},${sourceAssetId},'workspaces/a/final/result.png',${"b".repeat(64)},10,'image/png',${sql.json({ redactionStatus: "passed", manifestHash: "c".repeat(64) })})`;
    await sql`insert into node_evidence(id,workspace_id,node_execution_id,kind,asset_version_id,manifest) values(${nodeEvidenceId},${workspaceA},${nodeExecutionId},'result_screenshot',${assetVersionId},${sql.json({ manifestHash: "c".repeat(64) })})`;
    await sql`insert into evidence_packages(id,workspace_id,release_id) values(${evidencePackageId},${workspaceA},${releaseId})`;
    const packagePayload = {
      schemaVersion: "evidence-package/v1",
      releaseId,
      captureRunId,
      refs: [{ kind: "node_evidence", nodeEvidenceId, assetVersionId }],
      provenance: { flowVersionId, manifestHash: "c".repeat(64), workerImageDigest: "sha256:ffc33305f7b4b04057ae4a0caa70aad4fde87454fb403a1a22e7f931707dfcf9" },
    };
    await sql`insert into evidence_package_versions(id,workspace_id,evidence_package_id,version,capture_run_id,payload,content_hash) values(${evidencePackageVersionId},${workspaceA},${evidencePackageId},1,${captureRunId},${sql.json(packagePayload)},${await contentHash(packagePayload)})`;
    await sql`insert into brand_kits(id,workspace_id,product_id) values(${brandKitId},${workspaceA},${productId})`;
    await sql`insert into brand_kit_versions(id,workspace_id,brand_kit_id,version,schema_version,payload,content_hash,status,approved_at) values(${brandKitVersionId},${workspaceA},${brandKitId},1,'brand-kit/v1',${sql.json({ colors: {} })},${"d".repeat(64)},'approved',now())`;
    await sql`update releases set stage='evidence_review',revision=7,capture_run_id=${captureRunId} where workspace_id=${workspaceA} and id=${releaseId}`;
    await expect(service.approveNodeEvidence({ workspaceId: workspaceA, releaseId, nodeEvidenceId, expectedRevision: 7, idempotencyKey: "approve-node-evidence-missing", actorId: userId })).rejects.toMatchObject({ code: "EVIDENCE_OBJECT_INVALID" });
    approvalHead = { bytes: 10, sha256: "b".repeat(64), mimeType: "image/png" };
    const evidenceDecision = await service.approveNodeEvidence({ workspaceId: workspaceA, releaseId, nodeEvidenceId, expectedRevision: 7, idempotencyKey: "approve-node-evidence-1", actorId: userId });
    expect(evidenceDecision.release).toMatchObject({ stage: "evidence_review", revision: 8 });

    approvalHead = { bytes: 11, sha256: "b".repeat(64), mimeType: "image/png" };
    await expect(service.approveEvidence({
      workspaceId: workspaceA,
      releaseId,
      candidateId: evidencePackageVersionId,
      brandKitVersionId,
      expectedRevision: 8,
      idempotencyKey: "approve-evidence-drifted-object",
      actorId: userId,
    })).rejects.toMatchObject({ code: "EVIDENCE_OBJECT_INVALID" });
    approvalHead = { bytes: 10, sha256: "b".repeat(64), mimeType: "image/png" };
    const result = await service.approveEvidence({
      workspaceId: workspaceA,
      releaseId,
      candidateId: evidencePackageVersionId,
      brandKitVersionId,
      expectedRevision: 8,
      idempotencyKey: "approve-evidence-1",
      actorId: userId,
    });
    expect(result.release).toMatchObject({
      stage: "storyboard_generating",
      revision: 9,
      refs: { evidencePackageVersionId, brandKitVersionId },
    });
    expect((await sql`select status from evidence_package_versions where workspace_id=${workspaceA} and id=${evidencePackageVersionId}`)[0]?.status).toBe("approved");
  });

  it("atomically approves a Storyboard grounded in the pinned EvidencePackage", async () => {
    const capabilityIds = [1, 2, 3].map((order) =>
      `91000000-0000-4000-8000-00000000000${order}`
    );
    for (const [index, capabilityId] of capabilityIds.entries()) {
      await sql`insert into product_capabilities(id,workspace_id,product_id,name,description) values(${capabilityId},${workspaceA},${productId},${`Capability ${index + 1}`},'Verified capability')`;
    }
    const storyboardPayload = {
      schemaVersion: "storyboard/v1",
      releaseId,
      evidencePackageVersionId,
      scenes: capabilityIds.map((capabilityId, index) => ({
        id: `90000000-0000-4000-8000-00000000000${index + 1}`,
        order: index + 1,
        capabilityId,
        claimType: "browser_behavior",
        headline: `Scene ${index + 1}`,
        body: "Verified behavior",
        evidence: [{ kind: "node_evidence", nodeEvidenceId, assetVersionId }],
      })),
    };
    await sql`insert into storyboards(id,workspace_id,release_id) values(${storyboardId},${workspaceA},${releaseId})`;
    await sql`insert into storyboard_versions(id,workspace_id,storyboard_id,version,schema_version,payload,content_hash) values(${storyboardVersionId},${workspaceA},${storyboardId},1,'storyboard/v1',${sql.json(storyboardPayload)},${await contentHash(storyboardPayload)})`;
    const generated = await service.storyboardGenerated({ workspaceId: workspaceA, releaseId, candidateId: storyboardVersionId, expectedRevision: 9, idempotencyKey: "storyboard-generated-1", actorId: userId });
    expect(generated.release).toMatchObject({ stage: "storyboard_review", revision: 10 });

    const input = {
      workspaceId: workspaceA,
      releaseId,
      candidateId: storyboardVersionId,
      expectedRevision: 10,
      idempotencyKey: "approve-storyboard-1",
      actorId: userId,
    };
    const first = await service.approveStoryboard(input);
    const duplicate = await service.approveStoryboard(input);

    expect(duplicate).toEqual(first);
    expect(first.release).toMatchObject({
      stage: "preview_queued",
      revision: 11,
      refs: { storyboardVersionId },
    });
    expect((await sql`select status from storyboard_versions where workspace_id=${workspaceA} and id=${storyboardVersionId}`)[0]?.status).toBe("approved");
  });

  it("explicitly repins Storyboard and marks Bundle and RenderJob stale", async () => {
    const [current] = await sql`select payload,content_hash from storyboard_versions where workspace_id=${workspaceA} and id=${storyboardVersionId}`;
    await sql`insert into storyboard_versions(id,workspace_id,storyboard_id,version,schema_version,payload,content_hash,status,approved_at) values(${successorStoryboardVersionId},${workspaceA},${storyboardId},2,'storyboard/v1',${sql.json(current?.payload)},${current?.content_hash},'approved',now())`;
    await sql`insert into composition_bundles(id,workspace_id,release_id,storyboard_version_id,evidence_package_version_id,brand_kit_version_id,locale,plan_hash,bundle_hash,r2_key,status) values(${staleBundleId},${workspaceA},${releaseId},${storyboardVersionId},${evidencePackageVersionId},${brandKitVersionId},'en-US',${"a".repeat(64)},${"b".repeat(64)},'workspaces/a/bundle','quality_passed')`;
    await sql`insert into render_jobs(id,workspace_id,release_id,bundle_id,kind,status,render_key,requested_outputs) values(${staleRenderJobId},${workspaceA},${releaseId},${staleBundleId},'preview','succeeded','stale-render-key',${sql.json([{ variantId: "landscape" }])})`;
    await sql`update releases set preview_bundle_id=${staleBundleId} where workspace_id=${workspaceA} and id=${releaseId}`;
    const input = { workspaceId: workspaceA, releaseId, candidateId: successorStoryboardVersionId, expectedRevision: 11, idempotencyKey: "repin-storyboard-1", actorId: userId };
    const first = await service.repinStoryboard(input);
    expect(await service.repinStoryboard(input)).toEqual(first);

    expect(first.release).toMatchObject({ stage: "storyboard_review", revision: 12, refs: { storyboardVersionId: successorStoryboardVersionId } });
    expect(first.release.refs).not.toHaveProperty("previewBundleId");
    expect((await sql`select status from composition_bundles where workspace_id=${workspaceA} and id=${staleBundleId}`)[0]?.status).toBe("stale");
    expect((await sql`select status from render_jobs where workspace_id=${workspaceA} and id=${staleRenderJobId}`)[0]?.status).toBe("stale");
    expect(await sql`select id from release_invalidations where workspace_id=${workspaceA} and release_id=${releaseId}`).toHaveLength(2);
  });

  it("repins ProductFlow and invalidates every capture-derived object", async () => {
    const [current] = await sql`select payload,content_hash from product_flow_versions where workspace_id=${workspaceA} and id=${flowVersionId}`;
    await sql`insert into product_flow_versions(id,workspace_id,product_flow_id,version,schema_version,payload,content_hash,status,approved_at) values(${successorFlowVersionId},${workspaceA},${productFlowId},2,'product-flow/v1',${sql.json(current?.payload)},${current?.content_hash},'approved',now())`;
    const result = await service.repinFlow({ workspaceId: workspaceA, releaseId, candidateId: successorFlowVersionId, expectedRevision: 12, idempotencyKey: "repin-flow-1", actorId: userId });

    expect(result.release).toMatchObject({ stage: "capture_pending", revision: 13, refs: { productFlowVersionId: successorFlowVersionId } });
    expect(result.release.refs).not.toHaveProperty("captureRunId");
    expect(result.release.refs).not.toHaveProperty("evidencePackageVersionId");
    expect(result.release.refs).not.toHaveProperty("storyboardVersionId");
    expect(result.release.refs).not.toHaveProperty("previewBundleId");
    const invalidatedTypes = (await sql`select stale_object_type from release_invalidations where workspace_id=${workspaceA} and release_id=${releaseId} and changed_ref='product_flow_version'`).map((row) => row.stale_object_type);
    expect(invalidatedTypes).toEqual(expect.arrayContaining(["capture_run", "evidence_package_version", "storyboard_version", "composition_bundle", "render_job"]));
  });

  it("applies the remaining Brief, Evidence, and BrandKit repin matrix", async () => {
    const [brand] = await sql`select payload,content_hash from brand_kit_versions where workspace_id=${workspaceA} and id=${brandKitVersionId}`;
    await sql`insert into brand_kit_versions(id,workspace_id,brand_kit_id,version,schema_version,payload,content_hash,status,approved_at) values(${successorBrandKitVersionId},${workspaceA},${brandKitId},2,'brand-kit/v1',${sql.json(brand?.payload)},${brand?.content_hash},'approved',now())`;
    await sql`update releases set stage='preview_review',revision=20,capture_run_id=${captureRunId},evidence_package_version_id=${evidencePackageVersionId},storyboard_version_id=${successorStoryboardVersionId},preview_bundle_id=${staleBundleId} where workspace_id=${workspaceA} and id=${releaseId}`;
    const brandResult = await service.repinBrandKit({ workspaceId: workspaceA, releaseId, candidateId: successorBrandKitVersionId, expectedRevision: 20, idempotencyKey: "repin-brand-1", actorId: userId });
    expect(brandResult.release).toMatchObject({ stage: "preview_queued", revision: 21, refs: { brandKitVersionId: successorBrandKitVersionId } });
    expect(brandResult.release.refs).not.toHaveProperty("previewBundleId");

    const [evidence] = await sql`select payload,content_hash,capture_run_id from evidence_package_versions where workspace_id=${workspaceA} and id=${evidencePackageVersionId}`;
    await sql`insert into evidence_package_versions(id,workspace_id,evidence_package_id,version,capture_run_id,payload,content_hash,status,approved_at) values(${successorEvidencePackageVersionId},${workspaceA},${evidencePackageId},2,${evidence?.capture_run_id},${sql.json(evidence?.payload)},${evidence?.content_hash},'approved',now())`;
    await sql`update releases set stage='preview_review',revision=30,evidence_package_version_id=${evidencePackageVersionId},storyboard_version_id=${successorStoryboardVersionId},preview_bundle_id=${staleBundleId} where workspace_id=${workspaceA} and id=${releaseId}`;
    const evidenceResult = await service.repinEvidence({ workspaceId: workspaceA, releaseId, candidateId: successorEvidencePackageVersionId, expectedRevision: 30, idempotencyKey: "repin-evidence-1", actorId: userId });
    expect(evidenceResult.release).toMatchObject({ stage: "evidence_review", revision: 31, refs: { evidencePackageVersionId: successorEvidencePackageVersionId } });
    expect(evidenceResult.release.refs).not.toHaveProperty("storyboardVersionId");
    expect(evidenceResult.release.refs).not.toHaveProperty("previewBundleId");

    await sql`insert into release_brief_versions(id,workspace_id,release_id,version,schema_version,payload,content_hash,status,approved_at) values(${successorBriefId},${workspaceA},${releaseId},2,'release-brief/v1',${sql.json(briefPayload)},${await contentHash(briefPayload)},'approved',now())`;
    await sql`update releases set stage='preview_review',revision=40,capture_run_id=${captureRunId},evidence_package_version_id=${successorEvidencePackageVersionId},storyboard_version_id=${successorStoryboardVersionId},preview_bundle_id=${staleBundleId} where workspace_id=${workspaceA} and id=${releaseId}`;
    const briefResult = await service.repinBrief({ workspaceId: workspaceA, releaseId, candidateId: successorBriefId, expectedRevision: 40, idempotencyKey: "repin-brief-1", actorId: userId });
    expect(briefResult.release).toMatchObject({ stage: "flow_selecting", revision: 41, refs: { briefVersionId: successorBriefId } });
    expect(briefResult.release.refs).not.toHaveProperty("productFlowVersionId");
    expect(briefResult.release.refs).not.toHaveProperty("captureRunId");
    expect(briefResult.release.refs).not.toHaveProperty("evidencePackageVersionId");
    expect(briefResult.release.refs).not.toHaveProperty("storyboardVersionId");
    expect(briefResult.release.refs).not.toHaveProperty("previewBundleId");
  });
});
