import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("global environment isolation", () => {
  it("keeps TTS variables out of the root environment example", async () => {
    const rootExample = await readFile(".env.example", "utf8").catch(() => "");

    expect(rootExample).not.toMatch(/(?:TTS_PROVIDER|LISTENHUB_)/);
  });

  it("does not make ordinary web configuration parse TTS credentials", async () => {
    const webConfig = await readFile("lib/config.ts", "utf8");

    expect(webConfig).not.toMatch(/(?:getTtsEnv|tts\/config)/);
  });
});
