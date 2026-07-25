import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const WORKER_PHASES = [
  "queued",
  "capturing",
  "scripting",
  "synthesizing",
  "timing",
  "composing",
  "rendering",
  "verifying",
  "done",
  "failed",
] as const;

describe("worker phase contract", () => {
  it("keeps every worker phase in the web API type and progress presentation", async () => {
    const [apiSource, composerSource] = await Promise.all([
      readFile("src/lib/api.ts", "utf8"),
      readFile("src/components/marketing/launch-composer.tsx", "utf8"),
    ]);

    for (const phase of WORKER_PHASES) {
      expect(apiSource).toContain(`| "${phase}"`);
      expect(composerSource).toMatch(
        new RegExp(`^\\s*${phase}:\\s*["\\[]`, "m"),
      );
    }
  });
});
