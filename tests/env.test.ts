import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("global environment isolation", () => {
  it("keeps sensitive examples present but value-free", async () => {
    const rootExample = await readFile(".env.example", "utf8");

    for (const name of [
      "STEP_API_KEY",
      "LISTENHUB_API_KEY",
      "IMAP_PASSWORD",
      "SIGNUP_PASSWORD",
      "CVC_CREDENTIAL_MASTER_KEY",
      "GEMINI_API_KEY",
      "STEPFUN_API_KEY",
    ]) {
      expect(rootExample).toMatch(new RegExp(`^${name}=$`, "m"));
    }
  });

  it("does not make ordinary web configuration parse TTS credentials", async () => {
    const webConfig = await readFile("src/lib/site-config.ts", "utf8");

    expect(webConfig).not.toMatch(/(?:getTtsEnv|tts\/config)/);
  });
});
