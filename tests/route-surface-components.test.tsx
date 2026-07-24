import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CollectionView } from "@/components/control-plane/collection-view";
import { ProductOverviewView } from "@/components/products/product-overview-view";
import { ReleaseStageContent } from "@/components/releases/release-stage-content";

describe("operational route surfaces", () => {
  it("renders scannable collection rows from a typed view model", () => {
    const html = renderToStaticMarkup(
      <CollectionView
        ariaLabel="Products"
        rows={[
          {
            id: "product-1",
            title: "Test Product",
            description: "https://product.test",
            metadata: ["2 approved flows", "Updated today"],
            status: "Active",
            href: "/products/product-1",
          },
        ]}
      />
    );

    expect(html).toContain("Test Product");
    expect(html).toContain("2 approved flows");
    expect(html).toContain("Active");
    expect(html).toContain('href="/products/product-1"');
  });

  it("renders the reusable product asset hierarchy", () => {
    const html = renderToStaticMarkup(
      <ProductOverviewView
        product={{
          name: "Test Product",
          canonicalUrl: "https://product.test",
          status: "Active",
          brandKit: "Approved v3",
          capabilities: [
            {
              id: "cap-1",
              name: "Create reports",
              description: "Produces a verified report.",
            },
            {
              id: "cap-2",
              name: "Share reviews",
              description: "Collects focused feedback.",
            },
          ],
          flowSummary: "2 approved flows",
          releaseSummary: "1 active release",
        }}
      />
    );

    expect(html).toContain("https://product.test");
    expect(html).toContain("Approved v3");
    expect(html).toContain("Create reports");
    expect(html).toContain("2 approved flows");
    expect(html).toContain("1 active release");
  });
});

describe("release stage surfaces", () => {
  it.each([
    [
      "brief" as const,
      {
        kind: "brief" as const,
        audience: "Product teams shipping weekly",
        goal: "Show a verified release workflow",
        claims: ["Keep every claim tied to evidence"],
        channel: "Product launch",
        callToAction: "Review the release",
        version: "v2 draft",
      },
      [
        "Product teams shipping weekly",
        "Keep every claim tied to evidence",
        "v2 draft",
      ],
    ],
    [
      "flow" as const,
      {
        kind: "flow" as const,
        name: "Create and approve a release",
        version: "v4 approved",
        lastVerified: "2026-07-24",
        nodes: ["Create release", "Attach evidence", "Approve preview"],
      },
      ["Create and approve a release", "Attach evidence", "v4 approved"],
    ],
    [
      "evidence" as const,
      {
        kind: "evidence" as const,
        runId: "run-042",
        status: "Needs review",
        nodes: [
          {
            title: "Create release",
            checkpoint: "Passed",
            evidence: "Result screenshot",
            redaction: "Passed",
          },
        ],
      },
      ["run-042", "Result screenshot", "Needs review"],
    ],
    [
      "storyboard" as const,
      {
        kind: "storyboard" as const,
        version: "v1 draft",
        scenes: [
          {
            order: 1,
            headline: "Release with proof",
            body: "Review the product state change.",
            evidence: "node-evidence-17",
          },
        ],
      },
      ["Release with proof", "node-evidence-17", "v1 draft"],
    ],
    [
      "review" as const,
      {
        kind: "review" as const,
        previewStatus: "Quality passed",
        duration: "00:24",
        qualityChecks: ["Evidence references valid", "Frames are nonblank"],
        unresolvedFeedback: 2,
      },
      ["Quality passed", "Evidence references valid", "2 unresolved"],
    ],
    [
      "artifacts" as const,
      {
        kind: "artifacts" as const,
        renderStatus: "Complete",
        progress: 100,
        bundleHash: "a1b2c3d4",
        files: [
          {
            name: "launch-landscape.mp4",
            detail: "1920x1080 · 24 MB",
            status: "Ready",
          },
        ],
      },
      ["Complete", "launch-landscape.mp4", "a1b2c3d4"],
    ],
  ])(
    "renders %s data without changing route responsibility",
    (_step, model, expected) => {
      const html = renderToStaticMarkup(<ReleaseStageContent model={model} />);

      for (const text of expected) expect(html).toContain(text);
    }
  );
});
