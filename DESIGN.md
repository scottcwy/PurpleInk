---
name: PurpleInk
description: A monochrome creative-technology system animated by spectral indigo.
colors:
  white: "#FFFFFF"
  black: "#0A0A0A"
  neutral-50: "#FAFAFA"
  neutral-100: "#F5F5F5"
  neutral-300: "#E5E5E5"
  neutral-600: "#737373"
  night: "#03040A"
  night-surface: "#18181B"
  night-border: "#27272A"
  night-muted: "#A1A1AA"
  indigo-deep: "#352E82"
  indigo-spectrum-start: "#333DA7"
  indigo: "#6366F1"
  indigo-spectrum-end: "#7388DF"
  indigo-light: "#A5B4FC"
  verified-green: "#00C37A"
  icon-violet: "#7D3DF3"
typography:
  display:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "clamp(2.25rem, 6vw, 4.5rem)"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "normal"
  headline:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "clamp(1.65rem, 3vw, 2.35rem)"
    fontWeight: 750
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  label:
    fontFamily: "Geist Mono, Noto Sans Mono CJK SC, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "normal"
rounded:
  control-sm: "6px"
  control: "10px"
  media: "12px"
  panel: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.indigo}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.neutral-100}"
    textColor: "{colors.black}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    height: "44px"
  proof-badge:
    backgroundColor: "{colors.verified-green}"
    textColor: "{colors.night}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "5px 9px"
  media-card:
    backgroundColor: "{colors.neutral-100}"
    textColor: "{colors.black}"
    rounded: "{rounded.media}"
---

# Design System: PurpleInk

## Overview

**Creative North Star: "Spectral Ink"**

PurpleInk combines a near-monochrome interface with indigo imagery that behaves like digital ink, light, or moving photographic emulsion. The system is minimal and spatial rather than card-heavy, with restrained typography allowing product evidence, imagery, and interaction to carry the identity.

The shipped homepage is the visual reference surface, and `app/globals.css` is the normative implementation. If documentation and the rendered product disagree, inspect the implementation first and update the documentation or tokens without changing the rendered result.

**Key Characteristics:**

- Monochrome structure with spectral indigo at expressive moments.
- Creative-technology character without generic SaaS decoration.
- Product evidence remains inspectable; effects never obscure factual content.
- Flat, bounded operational surfaces and more expressive marketing interactions.
- Motion is tactile but never required to access content.

## Colors

Black, white, and neutral gray build the structure. Indigo carries brand, focus, selection, motion energy, and primary action. Verified green is reserved for the logo registration mark and confirmed proof states; icon violet is reserved for the static app-icon field.

### Primary

- **Spectral Indigo:** the `indigo`, `indigo-deep`, `indigo-spectrum-start`, `indigo-spectrum-end`, and `indigo-light` tokens form the extracted brand sequence. Do not replace them with a generic purple scale.

### Secondary

- **Verified Green:** use only for the registration mark and verified or approved states, always with a label or icon.

### Neutral

- **Paper:** `white`, `neutral-50`, `neutral-100`, and `neutral-300` support light surfaces, grouping, and borders.
- **Ink:** `black` is the light-theme foreground.
- **Night:** `night`, `night-surface`, `night-border`, and `night-muted` define the dark theme and dark media stages.

**The Evidence Rule.** Color never constitutes evidence by itself. Verification and intervention states always include text or an icon.

**The One-Emphasis Rule.** Ordinary layouts use one neutral surface system and, when needed, one indigo emphasis. New hues require an established brand asset or a new semantic need.

**The Semantic Consumption Rule.** Product components consume semantic CSS roles such as `background`, `foreground`, `accent`, `proof`, and `signal`; exact primitives are reserved for brand assets, gradient stops, and static assets that cannot use CSS variables.

## Typography

**Display Font:** Geist with system CJK sans-serif fallbacks

**Body Font:** Geist with system CJK sans-serif fallbacks

**Label/Mono Font:** Geist Mono with Noto Sans Mono CJK SC and platform monospace fallbacks

**Character:** The type system is quiet, direct, and operational. Sans-serif type carries all messages and controls; mono type marks compact machine-readable context rather than acting as decoration.

### Hierarchy

- **Display** (500, `clamp(2.25rem, 6vw, 4.5rem)`, 1): one hero or section statement where the surface genuinely supports it.
- **Headline** (750, `clamp(1.65rem, 3vw, 2.35rem)`, 1.15): major product-stage and section headings.
- **Title** (650-750, 1.05-1.5rem): panel, card, and workbench titles.
- **Body** (400-500, 0.875-1.125rem, 1.5-1.65): explanatory and review copy, generally capped near 72 characters per line.
- **Label** (650, 0.6875rem, normal tracking): identifiers, versions, timestamps, dimensions, hashes, execution states, and operational metadata.

**The Metadata Boundary Rule.** Mono type is reserved for machine-readable context. Body copy, navigation, and commands remain in Geist sans.

**The Tracking Floor Rule.** Body text, labels, and controls use normal letter spacing. Tight tracking is limited to large headings and never goes below `-0.04em`.

## Layout

Marketing surfaces use wide, spatial sections with constrained content columns and enough open space for imagery and interaction. Product surfaces use dense but orderly workbenches: bounded toolbars, split canvas-and-inspector layouts, and a six-stage release navigator. The main workbench changes from two columns to a single stacked flow below its layout breakpoint; horizontal process navigation remains scrollable instead of compressing labels.

Use the 4px-based spacing scale from the frontmatter and prefer stable grid tracks, explicit minimum heights, and constrained line lengths. Marketing media commonly uses a 4:5 portrait ratio; operational panels size to their task rather than adopting decorative card grids.

## Elevation & Depth

The system is flat by default. Borders, tonal layers, blur, and spectral imagery establish depth; shadows are reserved for signature interactions and focus response. The homepage launch CTA uses a soft `0 8px 32px rgb(0 0 0 / 12%)` shadow, while fields may use a restrained 20px focus halo. Ordinary workbench panels do not receive diffuse elevation.

**The Flat-by-Default Rule.** A resting surface uses a boundary or tonal shift, not a decorative border plus a large shadow.

## Shapes

Operational controls use compact 6-10px corners, media uses 12px corners, and framed workbench panels use 14px corners. Pills are reserved for status chips, compact metadata, circular icon actions, and the signature launch CTA. The full-pill hero control is a branded exception, not the default geometry for every button.

## Components

### Buttons

- **Primary:** compact product actions use spectral indigo, white text, a 10px radius, 44px minimum height, and 10px by 16px padding.
- **Secondary:** neutral-surface actions use the same geometry and type weight to avoid layout movement between variants.
- **Hover / Focus / Disabled:** hover translates upward by 2px over 180ms; focus uses a visible 3px indigo outline; disabled controls remain stationary at 52% opacity.
- **Launch CTA:** the homepage signature action is 64px tall, fully pill-shaped, inverted against its context, and ends in a 48px circular action area. Deep-indigo ink expansion and its soft shadow belong only to this interaction.

### Chips

- **Status badges:** fully pill-shaped, compact, and set in Geist Mono. Proof uses verified green; signal and neutral states reuse indigo and neutral semantic roles. Every state includes readable text or an icon.

### Cards / Containers

- **Media cards:** use 12px corners, portrait imagery when appropriate, the shared spectral treatment, and a subtle boundary.
- **Workbench panels:** use 14px corners, a 1px semantic border, flat paper or muted surfaces, and task-scaled internal padding.
- **Flow nodes:** use a 12px radius and compact row layout; hover and selection change boundary, tone, and at most 1px of vertical position without resizing.

### Inputs / Fields

- **Style:** fields use a semantic border, paper background, compact 8-10px corner radius, and at least 44px control height.
- **Focus:** border or outline shifts to the indigo ring and may add a restrained focus halo. Placeholder and disabled text remain legible in both themes.

### Navigation

- **Marketing:** fixed and blend-aware, with a fading backdrop mask and compact white links over the homepage opening scene.
- **Product:** conventional dark side navigation and neutral content surfaces, using the same Geist, Night, neutral, and indigo tokens.
- **Release stages:** a horizontal six-step navigator identifies the current stage with indigo and keeps locked or unavailable stages visibly distinct without relying on color alone.

## Do's and Don'ts

### Do:

- **Do** lead with real product frames, attached sources, approval state, and reproducible workflow.
- **Do** use the shared spectral gradient for expressive imagery so disparate source assets belong to one family.
- **Do** use Night primitives for dark surfaces and semantic tokens inside product components.
- **Do** preserve keyboard focus, reduced-motion behavior, and readable content in both themes.
- **Do** reuse existing motion timing and easing before introducing another motion vocabulary.

### Don't:

- **Don't** present PurpleInk as a generic prompt-to-video or AI design generator.
- **Don't** invent product evidence, customer logos, metrics, or testimonials.
- **Don't** use gradient text, decorative color orbs, glass cards, nested cards, or generic purple SaaS styling.
- **Don't** approximate the spectral effects with arbitrary gradients or one-off opacity values inside components.
- **Don't** use hardcoded white, black, zinc, or slate values when a semantic token already expresses the role.
