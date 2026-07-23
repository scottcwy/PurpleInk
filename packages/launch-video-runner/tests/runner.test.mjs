import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  InMemoryLaunchVideoJobRepository,
  InMemoryRunnerObjectStore,
  LaunchVideoRunner,
  RunnerContractError,
  StaleAttemptError,
  hyperframesQualityGate,
} from "../src/index.mjs";

const root = resolve(import.meta.dirname, "../../..");
const fixtureRoot = resolve(root, "packages/video-compiler/fixtures/golden-feature-launch");

async function fixture() {
  const skillInput = JSON.parse(await readFile(resolve(fixtureRoot, "skill-input.json"), "utf8"));
  const plan = JSON.parse(await readFile(resolve(fixtureRoot, "plan.json"), "utf8"));
  return { skillInput, plan };
}

function harness(plan, overrides = {}) {
  const repository = new InMemoryLaunchVideoJobRepository();
  const objectStore = new InMemoryRunnerObjectStore();
  const runner = new LaunchVideoRunner({
    repository,
    objectStore,
    direct: overrides.direct ?? (async () => plan),
    qualityGate: overrides.qualityGate ?? (async ({ bundle }) => ({
      schemaVersion: "video-quality-report/v1",
      bundleHash: bundle.bundleHash,
      variants: { landscape: { status: "passed" } },
    })),
  });
  return { repository, objectStore, runner };
}

describe("LaunchVideoRunner", () => {
  it("materializes the immutable bundle for the production Hyperframes quality gate", async () => {
    const { skillInput, plan } = await fixture();
    const { runner } = harness(plan);
    const compiled = await runner.run({ jobId: "job-quality", attempt: 1, workspaceId: skillInput.workspaceId, idempotencyKey: "quality", skillInput });
    let sawManifest = false;
    const report = await hyperframesQualityGate({ bundle: compiled.bundle }, {
      run: async (bundleRoot) => {
        sawManifest = JSON.parse(await readFile(resolve(bundleRoot, "manifest.json"), "utf8")).bundleHash === compiled.bundle.bundleHash;
        return { schemaVersion: "video-quality-report/v1", bundleHash: compiled.bundle.bundleHash, variants: { landscape: { status: "passed" } } };
      },
    });
    expect(sawManifest).toBe(true);
    expect(report.bundleHash).toBe(compiled.bundle.bundleHash);
  });

  it("publishes an immutable 16:9 preview bundle and reuses an identical idempotent request", async () => {
    const { skillInput, plan } = await fixture();
    const { runner, repository, objectStore } = harness(plan);
    const request = {
      jobId: "job-golden-1",
      attempt: 1,
      workspaceId: skillInput.workspaceId,
      idempotencyKey: "golden-preview-1",
      skillInput,
    };

    const first = await runner.run(request);
    const repeated = await runner.run(request);

    expect(repeated).toEqual(first);
    expect(first.status).toBe("succeeded");
    expect(first.bundle.manifest.variants).toContainEqual(expect.objectContaining({
      id: "landscape", width: 1920, height: 1080,
    }));
    expect(first.preview.variantId).toBe("landscape");
    expect(first.preview.r2Key).toContain(`/attempt-1/${first.bundle.bundleHash}/variants/landscape/index.html`);
    expect(objectStore.objects.get(first.preview.r2Key)?.toString()).toContain("feature-launch-landscape");
    expect(repository.get("job-golden-1")?.publishedBundleHash).toBe(first.bundle.bundleHash);
  });

  it("rejects cross-workspace provenance before invoking the director", async () => {
    const { skillInput, plan } = await fixture();
    let calls = 0;
    const { runner } = harness(plan, { direct: async () => { calls += 1; return plan; } });

    await expect(runner.run({
      jobId: "job-cross-workspace",
      attempt: 1,
      workspaceId: "workspace-attacker",
      idempotencyKey: "cross-workspace",
      skillInput,
    })).rejects.toBeInstanceOf(RunnerContractError);
    expect(calls).toBe(0);
  });

  it("recovers with a new attempt and fences the stale attempt from publication", async () => {
    const { skillInput, plan } = await fixture();
    let failQuality = true;
    const { runner, repository } = harness(plan, {
      qualityGate: async ({ bundle }) => {
        if (failQuality) throw new Error("hyperframes inspect failed");
        return { schemaVersion: "video-quality-report/v1", bundleHash: bundle.bundleHash, variants: { landscape: { status: "passed" } } };
      },
    });
    const base = { jobId: "job-retry", workspaceId: skillInput.workspaceId, skillInput };

    await expect(runner.run({ ...base, attempt: 1, idempotencyKey: "attempt-1" })).rejects.toThrow("hyperframes inspect failed");
    expect(repository.get("job-retry")?.status).toBe("failed");
    failQuality = false;
    const recovered = await runner.run({ ...base, attempt: 2, idempotencyKey: "attempt-2" });
    expect(recovered.status).toBe("succeeded");
    await expect(runner.publishCallback({
      jobId: "job-retry", attempt: 1, bundleHash: recovered.bundle.bundleHash,
    })).rejects.toBeInstanceOf(StaleAttemptError);
    expect(repository.get("job-retry")?.publishedAttempt).toBe(2);
  });
});
