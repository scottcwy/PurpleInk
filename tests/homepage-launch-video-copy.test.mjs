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
const header = await readFile(
  new URL("../components/header.tsx", import.meta.url),
  "utf8"
);
const footer = await readFile(
  new URL("../components/footer.tsx", import.meta.url),
  "utf8"
);
const globalStyles = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8"
);
const rootLayout = await readFile(
  new URL("../app/layout.tsx", import.meta.url),
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

test("removes pricing entry points while keeping the launch CTA", () => {
  assert.doesNotMatch(`${hero}\n${header}\n${footer}`, /#pricing|Pricing/);
  assert.match(
    hero,
    /<motion\.button[\s\S]*创建你的首个Launch Video[\s\S]*<\/motion\.button>/
  );
});

test("gives the launch CTA branded, accessible click feedback", () => {
  assert.match(hero, /useReducedMotion/);
  assert.match(hero, /onClick=\{handleLaunchClick\}/);
  assert.match(hero, /disabled=\{isLaunching\}/);
  assert.match(hero, /aria-busy=\{isLaunching\}/);
  assert.match(hero, /whileTap=\{\{ scale: 0\.98, y: 1 \}\}/);
  assert.match(hero, /bg-brand-launch-ink/);
  assert.match(hero, /var\(--brand-launch-ink\)/);
  assert.doesNotMatch(hero, /#6d28d9/);
  assert.match(hero, /scale: \[1, 1, 15\]/);
  assert.match(hero, /duration: 0\.68/);
  assert.match(hero, /setShowPreparing\(true\), 180/);
  assert.match(hero, /exit=\{\{ opacity: 0 \}\}/);
  assert.match(hero, /Preparing your Launch\.\.\./);
  assert.match(hero, /LoaderCircle/);
});

test("expands and fades a dedicated outer ring with the launch ink", () => {
  assert.doesNotMatch(hero, /key="white-glow-border"/);
  assert.doesNotMatch(hero, /inset-px[^"]*border-white\/60/);
  assert.match(hero, /key="launch-border-ring"/);
  assert.match(hero, /scale: \[0\.985, 1\.012, 1\.035\]/);
  assert.match(hero, /opacity: \[0, 0\.82, 0\]/);
  assert.match(hero, /duration: 0\.52/);
  assert.match(hero, /var\(--shadow-launch-ring\)/);
});

test("uses Geist as the production typography system", () => {
  for (const token of [
    "--pi-white: #ffffff",
    "--pi-black: #0a0a0a",
    "--pi-night: #03040a",
    "--pi-indigo-900: #352e82",
    "--pi-indigo-700: #333da7",
    "--pi-indigo-500: #6366f1",
    "--pi-indigo-400: #7388df",
    "--pi-mark-green: #00c37a",
    "--gradient-brand-spectrum",
  ]) {
    assert.match(globalStyles, new RegExp(token));
  }

  assert.match(
    rootLayout,
    /import \{ Geist, Geist_Mono \} from "next\/font\/google"/
  );
  assert.match(rootLayout, /variable: "--font-geist-sans"/);
  assert.match(rootLayout, /variable: "--font-geist-mono"/);
  assert.match(
    rootLayout,
    /className=\{`\$\{geistSans\.variable\} \$\{geistMono\.variable\}`\}/
  );
  assert.match(globalStyles, /--type-sans:\s*var\(--font-geist-sans\)/);
  assert.match(globalStyles, /--type-mono:\s*var\(--font-geist-mono\)/);
  assert.match(globalStyles, /"PingFang SC", "Microsoft YaHei"/);
  assert.match(globalStyles, /--font-sans: var\(--type-sans\)/);
  assert.match(globalStyles, /--font-mono: var\(--type-mono\)/);
});
