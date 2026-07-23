import { describe, expect, it } from "vitest";

import {
  getReleaseRouteAccess,
  releaseSteps,
} from "@/lib/releases/domain";
import { mockRelease } from "@/tests/fixtures/releases";

describe("Release navigation", () => {
  it("exposes the six fixed release steps in specification order", () => {
    expect(releaseSteps.map((step) => step.slug)).toEqual([
      "brief",
      "flow",
      "evidence",
      "storyboard",
      "review",
      "artifacts",
    ]);
  });

  it("allows the page represented by the current domain stage", () => {
    expect(getReleaseRouteAccess(mockRelease, "evidence")).toEqual({
      allowed: true,
    });
  });

  it("blocks a deep link when its prerequisite is incomplete", () => {
    const result = getReleaseRouteAccess(mockRelease, "storyboard");

    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe("evidence");
    expect(result.returnHref).toBe(`/releases/${mockRelease.id}/evidence`);
    expect(result.reason).toContain("Evidence");
  });

  it("preserves failed-from-stage when evaluating access", () => {
    const failedRelease = {
      ...mockRelease,
      lifecycle: "failed" as const,
      stage: "storyboard_review" as const,
      failedFromStage: "capturing" as const,
    };

    expect(getReleaseRouteAccess(failedRelease, "storyboard").allowed).toBe(
      false,
    );
  });
});
