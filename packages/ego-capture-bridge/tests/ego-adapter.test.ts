import { describe, expect, it } from "vitest";
import { EgoBrowserAdapter } from "../src/index.js";

describe("EgoBrowserAdapter", () => {
  it("uses one isolated task space and closes it after the happy path", async () => {
    const scripts: string[] = [];
    const adapter = new EgoBrowserAdapter(async (script) => {
      scripts.push(script);
      return { stdout: '{"ok":true}', stderr: "", exitCode: 0 };
    });

    await adapter.start("capture-session-1");
    await adapter.execute({
      id: "open-product",
      kind: "navigate",
      url: "https://app.example.com",
      effect: "read",
    });
    await adapter.complete();

    expect(scripts.join("\n")).toContain(
      "useOrCreateTaskSpace('purpleink-capture-capture-session-1')",
    );
    expect(scripts.join("\n")).toContain(
      "openOrReuseTab('https://app.example.com'",
    );
    expect(scripts.at(-1)).toContain(
      "completeTaskSpace('purpleink-capture-capture-session-1', { keep: false })",
    );
  });
});
