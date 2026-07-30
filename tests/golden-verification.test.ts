import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { verifyGolden } from "../server/src/compose/render";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("golden verification", () => {
  it("verifies chapter markup referenced by the root composition", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "purpleink-golden-"));
    temporaryDirectories.push(projectDir);
    await mkdir(join(projectDir, "compositions"));
    await mkdir(join(projectDir, "renders"));
    await writeFile(
      join(projectDir, "index.html"),
      [
        '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2"></script>',
        '<div data-skin="technical" data-composition-src="compositions/ch3-showcase.html"></div>',
        "<script>gsap.timeline({ paused: true })</script>",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(projectDir, "compositions", "ch3-showcase.html"),
      [
        '<div class="window"><div class="viewport">',
        '<img class="shot-visual" />',
        "</div></div>",
        "<style>",
        ".window { box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 8px 40px rgba(0,0,0,0.3); }",
        "</style>",
        '<script>gsap.timeline({ paused: true }).to(".shot-visual", { x: -40, y: 30, opacity: 1, ease: "power1.inOut" });</script>',
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(projectDir, "renders", "result.mp4"), new Uint8Array([0]));

    await expect(verifyGolden(projectDir)).resolves.toMatchObject({
      passed: true,
      failedCount: 0,
    });
  });
});
