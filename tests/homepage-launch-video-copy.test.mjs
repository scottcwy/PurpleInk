import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const toolsCarousel = await readFile(
  new URL("../components/tools-carousel.tsx", import.meta.url),
  "utf8"
);
const showcaseCards = await readFile(
  new URL("../components/showcase-cards.tsx", import.meta.url),
  "utf8"
);
const homePage = await readFile(
  new URL("../app/page.tsx", import.meta.url),
  "utf8"
);
const hero = await readFile(
  new URL("../components/hero.tsx", import.meta.url),
  "utf8"
);
const launchComposer = await readFile(
  new URL("../components/launch-composer.tsx", import.meta.url),
  "utf8"
);
const header = await readFile(
  new URL("../components/header.tsx", import.meta.url),
  "utf8"
);
const footer = await readFile(
  new URL("../components/footer.tsx", import.meta.url),
  "utf8"
);
const logoText = await readFile(
  new URL("../public/svg/logo-text.svg", import.meta.url),
  "utf8"
);

test("describes the four-step Launch Video workflow", () => {
  assert.match(
    toolsCarousel,
    /From product proof to launch video in four simple steps/
  );

  for (const step of ["Capture", "Shape", "Review", "Publish"]) {
    assert.match(toolsCarousel, new RegExp(`title: "${step}"`));
  }

  assert.doesNotMatch(toolsCarousel, /finished design|title: "Describe"/);
});

test("presents reusable Launch Video templates", () => {
  assert.match(showcaseCards, /Launch video templates, ready to customize/);

  for (const template of ["Product Launch", "Feature Drop", "Release Recap"]) {
    assert.match(showcaseCards, new RegExp(`title: "${template}"`));
  }

  assert.match(showcaseCards, />\s*View templates\s*</);
  assert.doesNotMatch(showcaseCards, /Pre-built designs|blank canvas/);
});

test("does not render pricing on the homepage", () => {
  assert.doesNotMatch(homePage, /components\/pricing|<Pricing\s*\/>/);
});

test("removes pricing entry points while keeping the launch entry", () => {
  assert.doesNotMatch(
    `${hero}\n${launchComposer}\n${header}\n${footer}`,
    /#pricing|Pricing/
  );
  assert.match(launchComposer, /创建你的首个 Launch Video/);
  assert.match(launchComposer, /Launch Video 即将开放/);
});

test("shows Community as the only primary navigation item", () => {
  assert.match(
    header,
    /const navLinks = \[\s*\{ href: "#community", label: "Community" \},?\s*\];/
  );

  for (const removedLabel of ["Features", "Templates", "Resources"]) {
    assert.doesNotMatch(header, new RegExp(`label: "${removedLabel}"`));
  }
});

test("removes the homepage product-flow tagline", () => {
  assert.doesNotMatch(
    hero,
    /PurpleInk turns verified product flows into reviewable, repeatable/
  );
  assert.match(hero, /bottom-24[^\"]*justify-end/);
});

test("keeps the footer wordmark clear of its right edge", () => {
  assert.match(footer, /h-44 max-w-338/);
  assert.match(footer, /className="w-full opacity-5/);
  assert.match(logoText, /width="120"/);
  assert.match(logoText, /viewBox="0 0 120 25"/);
});

test("gives the launch CTA branded, accessible click feedback", () => {
  assert.match(launchComposer, /useReducedMotion/);
  assert.match(launchComposer, /whileTap: \{ scale: 0\.98, y: 1 \}/);
  assert.match(launchComposer, /aria-label="开始生成"/);
  assert.match(launchComposer, /backgroundColor: active \? "#352e82"/);
  assert.doesNotMatch(launchComposer, /#6d28d9/);
  assert.match(launchComposer, /startRender/);
  assert.match(launchComposer, /pollUntilDone/);
  assert.match(launchComposer, /LoaderCircle/);
});

test("keeps the launch composer shadow free of an inner border", () => {
  assert.doesNotMatch(launchComposer, /key="white-glow-border"/);
  assert.doesNotMatch(launchComposer, /inset-px[^"]*border-white\/60/);
  assert.match(launchComposer, /shadow-\[0_8px_32px_rgba\(0,0,0,0\.12\)\]/);
});
