import { describe, expect, it } from "vitest";

import {
  parseEvidencePackageV1,
  parseStoryboardV1,
} from "@/lib/releases/contracts";

const releaseId = "30000000-0000-4000-8000-000000000001";
const captureRunId = "81000000-0000-4000-8000-000000000001";
const evidencePackageVersionId = "87000000-0000-4000-8000-000000000001";
const nodeEvidenceId = "85000000-0000-4000-8000-000000000001";
const sourceAssetId = "83000000-0000-4000-8000-000000000001";
const assetVersionId = "84000000-0000-4000-8000-000000000001";

const nodeRef = { kind: "node_evidence" as const, nodeEvidenceId, assetVersionId };
const sourceRef = { kind: "source_asset" as const, sourceAssetId, assetVersionId };

describe("canonical release contracts", () => {
  it("parses the frozen EvidencePackage v1 contract", () => {
    const payload = {
      schemaVersion: "evidence-package/v1",
      releaseId,
      captureRunId,
      refs: [nodeRef],
      provenance: {
        flowVersionId: "60000000-0000-4000-8000-000000000001",
        manifestHash: "a".repeat(64),
        workerImageDigest: `sha256:${"b".repeat(64)}`,
      },
    };

    expect(parseEvidencePackageV1(payload)).toEqual(payload);
  });

  it("rejects SourceAsset as proof of browser behavior", () => {
    const storyboard = {
      schemaVersion: "storyboard/v1",
      releaseId,
      evidencePackageVersionId,
      scenes: [1, 2, 3].map((order) => ({
        id: `90000000-0000-4000-8000-00000000000${order}`,
        order,
        capabilityId: `91000000-0000-4000-8000-00000000000${order}`,
        claimType: "browser_behavior",
        headline: `Scene ${order}`,
        body: "Verified behavior",
        evidence: order === 2 ? [sourceRef] : [nodeRef],
      })),
    };

    expect(() => parseStoryboardV1(storyboard)).toThrow(/NodeEvidence/);
  });
});
