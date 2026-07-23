import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  InMemoryProductFlowVersionRepository,
  ProductFlowVersionService,
} from "@purpleink/product-flow";
import {
  CaptureRunner,
  MockBrowserAdapter,
  capturePlanFromProductFlow,
} from "@purpleink/ego-capture-bridge";
import {
  InMemoryReleaseRepository,
  ReleaseDomainService,
  type Release,
  type ReleaseActorContext,
  type ReleaseCommandName,
} from "../../../lib/releases/domain";
import {
  InMemoryLaunchVideoJobRepository,
  InMemoryRunnerObjectStore,
  LaunchVideoRunner,
} from "../src/index.mjs";
import { evidencePackageDigest } from "../../../skills/product-launch-video/scripts/validation-lib.mjs";

const root = resolve(import.meta.dirname, "../../..");
const compilerFixture = resolve(root, "packages/video-compiler/fixtures/golden-feature-launch");
const flowFixture = resolve(root, "packages/product-flow/tests/fixtures/product-flow-v1.valid.json");

describe("Golden Product vertical pipeline", () => {
  it("reaches a provenance-locked 16:9 preview review through the real domain boundaries", async () => {
    const product = { id: "10000000-0000-4000-8000-000000000001", workspaceId: "00000000-0000-4000-8000-000000000001", canonicalUrl: "https://app.example.com" };
    const brief = { id: "brief-golden-001", workspaceId: product.workspaceId, productId: product.id, status: "approved" };
    const flowPayload = JSON.parse(await readFile(flowFixture, "utf8"));
    const skillInput = JSON.parse(await readFile(resolve(compilerFixture, "skill-input.json"), "utf8"));
    const plan = JSON.parse(await readFile(resolve(compilerFixture, "plan.json"), "utf8"));
    skillInput.workspaceId = product.workspaceId;
    skillInput.productId = product.id;
    for (const record of [skillInput.storyboard, skillInput.brandKit, skillInput.evidencePackage]) {
      record.workspaceId = product.workspaceId;
      record.productId = product.id;
    }
    for (const entry of skillInput.evidencePackage.entries) {
      entry.workspaceId = product.workspaceId;
      entry.productId = product.id;
    }
    skillInput.evidencePackage.sha256 = evidencePackageDigest(skillInput.evidencePackage.entries);
    const capabilities = [
      { id: "30000000-0000-4000-8000-000000000001", workspaceId: product.workspaceId, productId: product.id, name: "Project list", description: "Shows projects", status: "active" },
      { id: "30000000-0000-4000-8000-000000000002", workspaceId: product.workspaceId, productId: product.id, name: "Create project", description: "Creates a project", status: "active" },
    ];

    const flowService = new ProductFlowVersionService(
      new InMemoryProductFlowVersionRepository(),
      { newId: () => "60000000-0000-4000-8000-000000000001", now: () => new Date("2026-07-24T00:00:00.000Z") },
    );
    const draftFlow = await flowService.createVersion({
      workspaceId: product.workspaceId,
      productFlowId: "20000000-0000-4000-8000-000000000010",
      idempotencyKey: "discover-golden",
      payload: flowPayload,
    });
    const approvedFlow = await flowService.approveVersion({
      versionId: draftFlow.id,
      idempotencyKey: "approve-flow-golden",
      cleanReplayPassed: true,
      capabilities,
    });

    const release: Release = {
      id: skillInput.releaseId, workspaceId: product.workspaceId, productId: product.id,
      lifecycle: "active", stage: "brief_draft", failedFromStage: null, revision: 1,
      refs: {}, stale: [], retryAttempts: {},
    };
    const releaseRepository = new InMemoryReleaseRepository([release]);
    const releaseService = new ReleaseDomainService(releaseRepository, {
      async assertSatisfied(context, current, mutation) {
        if (context.workspaceId !== current.workspaceId) throw new Error("workspace mismatch");
        if ("subjectId" in mutation && mutation.subjectId === "foreign") throw new Error("foreign subject");
      },
    });
    const actor: ReleaseActorContext = { workspaceId: product.workspaceId, actorId: "actor-golden", role: "owner" };
    let revision = 1;
    const transition = async (name: ReleaseCommandName, subjectId?: string) => {
      const result = await releaseService.execute(actor, {
        releaseId: release.id, expectedRevision: revision, idempotencyKey: `golden-${name}`, name,
        ...(subjectId ? { subjectId } : {}),
      });
      revision = result.release.revision;
      return result.release;
    };

    await transition("approve_brief", brief.id);
    await transition("start_discovery");
    await transition("discovery_completed");
    await transition("approve_flow", approvedFlow.id);
    await transition("start_capture", skillInput.captureRunId);

    const browser = new MockBrowserAdapter();
    const bridgeRunner = new CaptureRunner(browser, () => undefined, async () => ["203.0.113.8"]);
    const capture = await bridgeRunner.run(capturePlanFromProductFlow(
      "40000000-0000-4000-8000-000000000010",
      approvedFlow.payload,
      { fixtures: { "draft-project-name": "Golden draft" } },
    ));
    expect(capture.state).toBe("completed");
    expect(browser.executedActionIds).toHaveLength(3);

    await transition("capture_completed");
    await transition("approve_evidence", "evidence-result");
    await transition("storyboard_generated");
    await transition("approve_storyboard", skillInput.storyboardVersionId);

    const objects = new InMemoryRunnerObjectStore();
    const videoRunner = new LaunchVideoRunner({
      repository: new InMemoryLaunchVideoJobRepository(),
      objectStore: objects,
      direct: async () => plan,
      qualityGate: async ({ bundle }) => ({ schemaVersion: "video-quality-report/v1", bundleHash: bundle.bundleHash, variants: { landscape: { status: "passed" } } }),
    });
    const video = await videoRunner.run({
      jobId: "job-golden-e2e", attempt: 1, workspaceId: product.workspaceId,
      idempotencyKey: "golden-e2e-preview", skillInput,
    });
    await transition("preview_started");
    const finalRelease = await transition("preview_completed");

    expect(finalRelease.stage).toBe("preview_review");
    expect(finalRelease.refs).toMatchObject({
      briefVersionId: brief.id,
      productFlowVersionId: approvedFlow.id,
      captureRunId: skillInput.captureRunId,
      storyboardVersionId: skillInput.storyboardVersionId,
    });
    expect(video.preview).toMatchObject({ variantId: "landscape" });
    expect(video.bundle.manifest.variants.find((variant: { id: string }) => variant.id === "landscape")).toMatchObject({ width: 1920, height: 1080 });
    expect(await objects.get(video.preview.r2Key)).not.toBeNull();
  });
});
