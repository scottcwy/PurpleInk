# PurpleInk Logo and Button Semantics Spec

> Status: Draft v0.3 for review
> Date: 2026-07-23
> Scope: `/frontend` Logo assets and existing button semantics only
> Source of truth: `2026-07-20-verified-product-video-prd.md`
> Implementation gate: Do not implement before approval.

## 1. Objective

Replace the current Kraft/template Logo with **PurpleInk**, and align existing acquisition-button wording with PurpleInk's current launch stage.

PurpleInk is a verified product-video system that turns real product flows into reviewable, repeatable, brand-ready release videos. This positioning informs naming and button intent only; it does not authorize any page-copy or interface redesign.

## 2. In Scope

### Logo

- Replace the existing header Logo with a PurpleInk horizontal mark.
- Replace the existing footer wordmark with PurpleInk.
- Replace favicon, app icon, and Apple icon with the matching PurpleInk mark where those slots already exist.
- Change Logo `alt` text and home-link accessible name from Kraft/template naming to PurpleInk.
- Preserve every existing asset slot, rendered box, aspect-ratio contract, placement, opacity treatment, and responsive rule.

Logo direction for review: a restrained PurpleInk wordmark and `P`-based symbol, optionally combining a frame or verification cue. Do not recolor or rename the existing Kraft mark.

### Button Semantics

Only acquisition-oriented button/link labels may change:

| Existing label | Proposed PurpleInk label | Intended meaning |
| --- | --- | --- |
| `Join` | `Join waitlist` | Request early access |
| `Get started` | `Join waitlist` | Request early access |
| `Upgrade plan` | `Join waitlist` | Request early access; no live paid upgrade is implied |
| `Contact sales` | `Contact sales` | Enterprise enquiry; unchanged |
| `Join waitlist` | `Join waitlist` | Existing early-access action; unchanged |

If `Start Free` or `Sign in` becomes rendered from `siteConfig`, use `Join waitlist` and `Sign in` respectively. Do not expose a free-start claim unless a working free onboarding flow exists.

Interaction-control labels such as menu, theme, carousel, FAQ, attachment, voice, and send controls remain unchanged because their current semantics already describe their actions.

## 3. Frozen Frontend

Except for the approved Logo pixels and button text literals, the frontend must remain unchanged:

- No changes to layout, DOM structure, components, CSS, colors, typography, spacing, dimensions, icons, animation, hover/focus states, responsive behavior, or z-index.
- No changes to button type, click/submit behavior, enabled state, event handlers, destinations, form behavior, or analytics hooks.
- No new, removed, moved, renamed, split, or merged components or sections.
- No changes to headings, body copy, navigation labels, pricing content, testimonials, FAQs, metadata, URLs, or product functionality.
- `components/hero.tsx` remains byte-for-byte unchanged.
- Existing Logo containers must not be resized to fit the new artwork; the artwork must fit the current contracts.

Brand names that remain in non-Logo page copy are knowingly out of scope for this change and require a separate content spec.

## 4. Permitted Files

Implementation may touch only:

- Existing Logo/icon asset files under `public` and `app`.
- `components/header.tsx`, only for Logo `alt`/accessible naming and the approved acquisition label.
- `components/footer.tsx`, only where required by the existing Logo asset reference.
- `components/pricing.tsx`, only for the approved CTA literals.
- `components/bottom-cta.tsx`, only if the approved CTA literal differs from the current one.
- `lib/config.ts`, only for acquisition-button literals that are actually consumed.

Any additional file requires a spec amendment before implementation.

## 5. Acceptance Criteria

1. Header, footer, favicon, app icon, and Apple icon use the approved PurpleInk identity without broken assets.
2. Logo accessible naming identifies `PurpleInk`; decorative footer artwork remains hidden from assistive technology.
3. Acquisition labels match the approved mapping and do not imply unavailable signup, pricing, or account flows.
4. `components/hero.tsx` retains its pre-change content hash.
5. Outside the Logo and approved button-text regions, before/after desktop and mobile screenshots have no visual regression.
6. Existing buttons retain identical structure, computed styles, dimensions, behavior, and destinations; no label wraps, clips, overlaps, or shifts surrounding layout at supported breakpoints.
7. The diff contains only approved Logo/icon assets, Logo accessibility text, and button-label literals.
8. Lint, typecheck, production build, and browser smoke checks pass.

## 6. Approval Required

Implementation starts only after approval of:

1. The final PurpleInk mark and wordmark artwork.
2. The button-label mapping above, especially whether all non-enterprise acquisition actions should say `Join waitlist`.
