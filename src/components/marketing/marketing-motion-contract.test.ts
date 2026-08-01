import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readMarketingSource = (name: string) =>
  readFileSync(`src/components/marketing/${name}`, "utf8");

describe("marketing motion contracts", () => {
  it("uses the shared spatial spring for FAQ layout and height", () => {
    const source = readMarketingSource("faq.tsx");

    expect(source).toContain("SPRING_SPATIAL_DEFAULT");
    expect(source).not.toContain("[0.25, 0.46, 0.45, 0.94]");
    expect(source).toContain("default: SPRING_SPATIAL_DEFAULT");
  });

  it("keeps marketing hover feedback on the fast semantic duration", () => {
    const trustedBy = readMarketingSource("trusted-by.tsx");
    const launchComposer = readMarketingSource("launch-composer.tsx");
    const showcaseCards = readMarketingSource("showcase-cards.tsx");
    const bottomCta = readMarketingSource("bottom-cta.tsx");
    const header = readMarketingSource("header.tsx");

    expect(launchComposer).toContain("motionReady && prefersReducedMotion");
    expect(launchComposer).not.toContain(
      "const interactive = prefersReducedMotion"
    );
    expect(trustedBy).not.toContain("transition-all");
    expect(trustedBy.match(/duration-fast/g)?.length).toBeGreaterThanOrEqual(4);
    for (const source of [launchComposer, showcaseCards]) {
      expect(source).toContain("transition-transform");
      expect(source).toContain("duration-fast");
      expect(source).toContain("group-hover:translate-x-0.5");
    }
    expect(bottomCta).not.toContain(["duration", "200"].join("-"));
    expect(bottomCta).toContain(
      "transition-shadow duration-fast ease-standard"
    );
    expect(header).not.toContain(["duration", "300"].join("-"));
  });

  it("flattens scroll-linked and in-view motion for reduced-motion users", () => {
    const hero = readMarketingSource("hero.tsx");
    const toolsCarousel = readMarketingSource("tools-carousel.tsx");

    expect(hero).toContain("useReducedMotion");
    expect(hero).toContain("prefersReducedMotion ? 0");
    expect(hero).toContain("prefersReducedMotion ? 1");
    expect(hero).toContain("motion-reduce:transform-none!");
    expect(hero).toContain("motion-reduce:opacity-100!");
    expect(toolsCarousel).toContain("motion-reduce:transform-none!");
    expect(toolsCarousel).toContain("motion-reduce:opacity-100!");
  });

  it("uses Motion for the marketing image reveal without deleting render contracts", () => {
    const imageReveal = readMarketingSource("image-reveal.tsx");
    const packageSource = readFileSync("package.json", "utf8");
    const seekBridge = readFileSync("src/lib/gsap/seek-bridge.ts", "utf8");

    expect(imageReveal).not.toContain('from "gsap"');
    expect(imageReveal).not.toContain("ScrollTrigger");
    expect(imageReveal).toContain("useScroll");
    expect(imageReveal).toContain("useTransform");
    expect(imageReveal).toContain("useReducedMotion");
    expect(imageReveal).toContain("useSyncExternalStore");
    expect(imageReveal).toContain("motion-reduce:transform-none!");
    expect(imageReveal).toContain("motion-reduce:opacity-100!");
    expect(packageSource).not.toContain('"gsap"');
    expect(seekBridge).toContain("gsap.timeline({ paused: true })");
    expect(seekBridge).toContain("tl.seek(frame / fps)");
    expect(seekBridge).not.toMatch(/from ['"]gsap/u);
  });
});
