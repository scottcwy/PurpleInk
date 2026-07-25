import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("TTS pipeline placement", () => {
  it("prepares narration before visual composition and muxes after rendering", async () => {
    const source = await readFile("server/src/compose/run-pipeline.ts", "utf8");
    const build = source.indexOf("await buildVideoModel(");
    const narration = source.indexOf("await prepareNarrationAssets(");
    const chapters = source.indexOf("await generateChapters(");
    const render = source.indexOf("await renderProject(");
    const mux = source.indexOf("await muxNarration(");

    expect(build).toBeGreaterThan(-1);
    expect(narration).toBeGreaterThan(build);
    expect(chapters).toBeGreaterThan(narration);
    expect(render).toBeGreaterThan(chapters);
    expect(mux).toBeGreaterThan(render);
  });

  it("keeps the original visual model unchanged through composition", async () => {
    const source = await readFile("server/src/compose/run-pipeline.ts", "utf8");

    expect(source).toContain("const visualModel = await buildVideoModel(");
    expect(source).not.toContain("model = narration.model");
    expect(source).toContain(
      "await generateChapters(ctx, captureDir, visualModel)"
    );
    expect(source).toContain("durationSec: visualModel.durationSec");
  });

  it("loads root .env.local only at server and render CLI entrypoints", async () => {
    const [serverEntry, cliEntry] = await Promise.all([
      readFile("server/src/index.ts", "utf8"),
      readFile("server/scripts/render-capture.ts", "utf8"),
    ]);

    expect(serverEntry).toContain('.env.local"))');
    expect(cliEntry).toContain('.env.local"))');
  });
});
