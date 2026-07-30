import { Script } from "node:vm";
import { describe, expect, it } from "vitest";

import type { VideoModel } from "../server/src/compose/model";
import { buildRootHtml } from "../server/src/compose/chapters/root-html";
import { renderTemplateChapter } from "../server/src/compose/chapters/template-fallback";
import { validateHyperFramesHtml } from "../server/src/compose/chapters/validate";
import { renderIndexHtml } from "../server/src/compose/template";

const VALID_CHAPTER = `
<div
  data-composition-id="ch1-opening"
  data-width="1920"
  data-height="1080"
  data-duration="5"
>
  <style>#circle { left: 0; top: 0; }</style>
  <div id="circle"></div>
</div>
<script>
window.__timelines = window.__timelines || {};
window.__timelines["ch1-opening"] = gsap.timeline({ paused: true });
</script>
`;

describe("HyperFrames chapter validation", () => {
  it("accepts valid CSS declarations", () => {
    expect(validateHyperFramesHtml(VALID_CHAPTER, "ch1-opening")).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("rejects JavaScript assignment syntax embedded in CSS", () => {
    const invalid = VALID_CHAPTER.replace("left: 0", "left=0");

    expect(validateHyperFramesHtml(invalid, "ch1-opening")).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["Invalid CSS assignment syntax"]),
    });
  });

  it("rejects infinite GSAP repeats", () => {
    const invalid = VALID_CHAPTER.replace(
      'window.__timelines["ch1-opening"]',
      'gsap.to("#circle", { repeat: -1 }); window.__timelines["ch1-opening"]',
    );

    expect(validateHyperFramesHtml(invalid, "ch1-opening")).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["Infinite GSAP repeat is not seek-safe"]),
    });
  });

  it("rejects invalid inline JavaScript before render", () => {
    const invalid = VALID_CHAPTER.replace(
      'window.__timelines = window.__timelines || {};',
      "#circle { perspective: 1200px; }",
    );

    expect(validateHyperFramesHtml(invalid, "ch1-opening")).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["Invalid inline script syntax"]),
    });
  });

  it("rejects block comments that escaped style and script tags", () => {
    const invalid = VALID_CHAPTER.replace(
      '<div id="circle"></div>',
      '<div id="circle"></div>/* visible comment */',
    );

    expect(validateHyperFramesHtml(invalid, "ch1-opening")).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["Visible block comment outside style or script"]),
    });
  });

  it("rejects SFMono without an explicit font face", () => {
    const invalid = VALID_CHAPTER.replace(
      "#circle {",
      "#circle { font-family: SFMono-Regular, monospace;",
    );

    expect(validateHyperFramesHtml(invalid, "ch1-opening")).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["SFMono-Regular requires an explicit @font-face"]),
    });
  });
});

describe("chapter project contracts", () => {
  const model: VideoModel = {
    id: "chapter-contract",
    name: "Chapter contract",
    brand: { title: "PurpleInk", tagline: "Evidence first" },
    hero: { headline: "真实演示", lede: "可靠输出", ctas: [], chips: [] },
    valueProps: [],
    logos: [],
    pricing: [],
    cta: { headline: "完成", command: "pnpm render" },
    palette: {
      fg: "#ffffff",
      bg: "#000000",
      accent: "#7c3aed",
      accentFg: "#ffffff",
      muted: "#999999",
      secondary: "#111111",
      border: "#333333",
      fontFamily: "Inter, sans-serif",
    },
    skin: {
      id: "technical",
      motion: { enter: "power2.out", transition: "cut" },
      minShot: 1,
      maxShots: 5,
    },
    scenes: [{
      kind: "shot-window",
      start: 0,
      duration: 5,
      shots: [{ src: "assets/screen.png", caption: "界面", tall: false }],
    }],
    durationSec: 5,
  };

  it("assigns a stable composition id to every root chapter host", () => {
    const html = buildRootHtml(
      [{
        id: "ch3-showcase",
        title: "Showcase",
        startSec: 0,
        durationSec: 5,
        shotTypes: ["shot-window"],
        assets: ["screen.png"],
      }],
      model.palette,
      model.skin,
      5,
    );

    expect(html).toContain(
      'data-composition-id="host-ch3-showcase" data-composition-src="compositions/ch3-showcase.html"',
    );
  });

  it("keeps PageCam CSS out of the generated timeline script", () => {
    const html = renderTemplateChapter("ch3-showcase", model);

    expect(html).not.toMatch(/^\s*#s0 \.shot \{[^}]+\}\s*$/m);
    expect(validateHyperFramesHtml(html, "ch3-showcase")).toMatchObject({
      valid: true,
      errors: [],
    });
  });

  it("keeps every legacy template inline script syntactically valid", () => {
    const html = renderIndexHtml(model);
    const scripts = [...html.matchAll(
      /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi,
    )];

    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(() => new Script(script[1] ?? "")).not.toThrow();
    }
  });
});
