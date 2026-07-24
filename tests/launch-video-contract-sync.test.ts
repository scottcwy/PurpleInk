import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { validateSchema } from "../skills/product-launch-video/scripts/validation-lib.mjs";

const fixtureUrl = new URL("../packages/video-compiler/fixtures/golden-feature-launch/skill-input.json", import.meta.url);
const planFixtureUrl = new URL("../packages/video-compiler/fixtures/golden-feature-launch/plan.json", import.meta.url);

async function canonicalInput() {
  return JSON.parse(await readFile(fixtureUrl, "utf8"));
}

describe("LaunchVideo canonical contract synchronization", () => {
  it("accepts singular ProductCapability IDs and discriminated EvidenceRefs", async () => {
    expect(await validateSchema(await canonicalInput(), "input-v1.schema.json")).toEqual([]);
  });

  it("rejects ambiguous evidence without a discriminant", async () => {
    const input = await canonicalInput();
    delete input.evidencePackage.entries[0].ref.kind;
    expect(await validateSchema(input, "input-v1.schema.json")).not.toEqual([]);
  });

  it("accepts canonical ProductCapability and EvidenceRef fields in a plan", async () => {
    const plan = JSON.parse(await readFile(planFixtureUrl, "utf8"));
    expect(await validateSchema(plan, "launch-video-plan-v1.schema.json")).toEqual([]);
    delete plan.beats[0].evidence[0].kind;
    expect(await validateSchema(plan, "launch-video-plan-v1.schema.json")).not.toEqual([]);
  });
});
