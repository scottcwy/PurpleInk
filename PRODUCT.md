# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

PurpleInk initially serves independent SaaS founders, product marketing teams, and product-video studios that launch browser-based products frequently. They need to turn a release brief and real product behavior into a credible, publishable video without rebuilding the script, recording, edit, and channel variants for every release.

The initial market is browser-delivered AI SaaS, developer tools, B2B SaaS, data products, and workflow tools with frequent releases, a controllable staging or demo environment, and a product UI that carries the product's value.

## Product Purpose

PurpleInk turns approved recordings or verified ProductFlows into reviewable, reproducible, brand-consistent release videos. It exists to make product truth, narrative structure, approval, and repeat production part of one continuous release workflow.

Success means a team can produce a first reviewable draft in less than 30 minutes, publish without external editing, and make the second release materially faster by reusing its BrandKit, ProductFlow, Storyboard, and Template.

## Positioning

PurpleInk is a verified product-story production system rather than a generic AI video generator or recorder. Its differentiator is the chain from approved, immutable product evidence to a structured Storyboard and deterministic, channel-ready renders. Every factual scene remains traceable to the product capability, captured evidence, approved version, and release that supports it.

## Operating Context

Teams begin with a ReleaseBrief and a browser product in a controlled demo or staging environment. The release workflow proceeds through Brief, Flow, Evidence, Storyboard, Review, and Artifacts. A Linux Playwright Capture Worker discovers and clean-replays an approved ProductFlow in an isolated browser context; reviewers approve evidence and narrative inputs before preview and final rendering.

The same approved Storyboard and Composition Bundle can produce 16:9 and 9:16 outputs. BrandKit, ProductFlow, Storyboard, and Template records persist across releases so later launches can reuse established product truth and brand direction.

## Capabilities and Constraints

- ProductFlows represent 3-8 semantic business steps, not raw browser traces.
- Browser behavior and product-state claims require approved NodeEvidence; factual Storyboard scenes must reference approved evidence and a ProductCapability.
- Approved versions are immutable. Replacing a pinned input is an explicit, revision-guarded operation that invalidates affected downstream work.
- Capture and rendering run in separate trust boundaries. Credentials, cookies, tokens, signed URLs, and unsanitized cross-origin content must not enter evidence or render inputs.
- The MVP supports browser products and structured Storyboards. It does not support native app capture, open-ended autonomous browsing, a free-form video timeline, arbitrary user JavaScript templates, or unsupervised high-risk actions such as payment, deletion, publishing, or permission changes.
- Product UI may be cropped, masked, zoomed, and emphasized, but it must not be redrawn or altered in ways that change product truth.

## Brand Commitments

PurpleInk is precise, assured, and editorially decisive. It should feel like a trusted release director: creative enough to make a launch memorable, disciplined enough to show only what the product can prove, and calm enough for a team to review under deadline.

The PurpleInk name, logo registration mark, app icon, and shipped homepage are existing brand assets. HyperFrames, models, and implementation details are supporting technology rather than the customer-facing identity.

## Evidence on Hand

- The product definition and market assumptions are recorded in `2026-07-20-verified-product-video-prd.md`.
- The current ProductFlow, capture, release, and launch-video behavior is specified in `docs/specs/2026-07-23-product-flow-launch-video-system.md` and `docs/specs/2026-07-23-engineering-contracts.md`.
- The repository contains implemented release-control surfaces, domain contracts, compiler validation, and automated tests for approvals, immutable versions, provenance, and invalidation behavior.
- The homepage includes product imagery under `public/img/`; these are product-owned visual assets, not customer testimonials or independent performance evidence.
- No confirmed customer logos, testimonials, case studies, press claims, or production outcome metrics are currently available. Future surfaces must not fabricate them.

## Product Principles

1. Show proof before promise: every product claim should have a visible or inspectable source.
2. Direct the release, not the software tutorial: lead with the outcome, then use one product moment to prove each value point.
3. Make reviewability visible: approval, provenance, versions, and factual status are part of the product story.
4. Make reuse tangible: communicate a continuous release system, not a one-off generation trick.
5. Practice truthful marketing: use real product artifacts or clearly labeled prototypes, never fabricated customer evidence.

## Anti-references

- Not a generic prompt-to-video or AI design generator.
- Not a cinematic generative-video showcase built around spectacle.
- Not a tutorial recorder or a free-form timeline editor.
- Not a purple-gradient SaaS template with invented metrics, logos, or testimonials.
- Not a technical renderer brand centered on HyperFrames, models, or implementation details.

## Accessibility & Inclusion

Target WCAG 2.1 AA. Preserve keyboard navigation, visible focus, semantic headings, reduced-motion behavior, readable product UI at common viewing sizes, and color-independent verification states.
