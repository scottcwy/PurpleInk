import { describe, expect, it } from "vitest";

import { buildBoundaryCuePlan } from "./plan";

describe("buildBoundaryCuePlan", () => {
  it("builds the fixed boundary palette deterministically", () => {
    const input = {
      fps: 30,
      totalFrames: 300,
      boundaries: [0, 90, 180, 270],
    };

    const first = buildBoundaryCuePlan(input);

    expect(first).toMatchObject({
      fps: 30,
      totalFrames: 300,
      cues: [
        { preset: "ping", atFrame: 9, gainDb: -24 },
        { preset: "whoosh", atFrame: 90, gainDb: -24 },
        { preset: "tick", atFrame: 180, gainDb: -26 },
        { preset: "impact", atFrame: 270, gainDb: -24 },
      ],
    });
    expect(first).toEqual(buildBoundaryCuePlan(input));
    expect(first.timingHash).toBe(
      "d33cf9d280fd3dfc9dbb6abd41bda87b10cb9c6b1382b681bdd96f7030f12da8"
    );
    expect(first.cuePlanHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it.each([
    { fps: 0, totalFrames: 30 },
    { fps: Number.NaN, totalFrames: 30 },
    { fps: Number.POSITIVE_INFINITY, totalFrames: 30 },
    { fps: 30, totalFrames: 0 },
    { fps: 30, totalFrames: 1.5 },
  ])("rejects invalid timeline dimensions: %o", ({ fps, totalFrames }) => {
    expect(() =>
      buildBoundaryCuePlan({ fps, totalFrames, boundaries: [0] })
    ).toThrow(RangeError);
  });

  it("normalizes, sorts and deduplicates valid frame boundaries", () => {
    const plan = buildBoundaryCuePlan({
      fps: 30,
      totalFrames: 300,
      boundaries: [180, -1, 90, 90, 1.5, 301],
    });

    expect(plan.cues).toEqual([
      { preset: "ping", atFrame: 90, gainDb: -24 },
      { preset: "whoosh", atFrame: 180, gainDb: -24 },
    ]);
  });

  it("keeps every emitted cue at least 250 ms apart", () => {
    const plan = buildBoundaryCuePlan({
      fps: 30,
      totalFrames: 60,
      boundaries: [0, 5, 10, 12, 20],
    });

    expect(plan.cues.map((cue) => cue.atFrame)).toEqual([9, 20]);
    expect(
      plan.cues.every(
        (cue, index, cues) =>
          index === 0 || cue.atFrame - cues[index - 1]!.atFrame >= 8
      )
    ).toBe(true);
  });

  it("caps the full-video cue plan at 24 entries", () => {
    const plan = buildBoundaryCuePlan({
      fps: 30,
      totalFrames: 1_000,
      boundaries: Array.from({ length: 50 }, (_, index) => index * 10),
    });

    expect(plan.cues).toHaveLength(24);
  });

  it("changes both hashes when the normalized timing changes", () => {
    const first = buildBoundaryCuePlan({
      fps: 30,
      totalFrames: 300,
      boundaries: [0, 90],
    });
    const second = buildBoundaryCuePlan({
      fps: 30,
      totalFrames: 301,
      boundaries: [0, 90],
    });

    expect(first.timingHash).not.toBe(second.timingHash);
    expect(first.cuePlanHash).not.toBe(second.cuePlanHash);
  });
});
