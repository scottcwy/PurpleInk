import { describe, expect, it } from "vitest";
import { REVEAL_ORIGINS } from "./image-reveal";

describe("image reveal gallery motion", () => {
  it("keeps scroll reveal transforms within a non-overlapping range", () => {
    expect(REVEAL_ORIGINS).toHaveLength(3);
    expect(
      REVEAL_ORIGINS.every((origin) => Math.abs(origin.xPercent) <= 140),
    ).toBe(true);
    expect(REVEAL_ORIGINS.every((origin) => origin.scaleX <= 1.4)).toBe(true);
    expect(REVEAL_ORIGINS.every((origin) => origin.scaleY >= 0.85)).toBe(true);
    expect(REVEAL_ORIGINS.every((origin) => origin.blur <= 3)).toBe(true);
  });
});
