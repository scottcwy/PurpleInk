---
name: PurpleInk
description: A monochrome creative-technology system animated by spectral indigo.
sourceOfTruth: app/globals.css
referenceSurface: app/page.tsx
fonts:
  sans: "Geist, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
  mono: "Geist Mono, Noto Sans Mono CJK SC, ui-monospace, monospace"
colors:
  white: "#FFFFFF"
  black: "#0A0A0A"
  night: "#03040A"
  night-asset: "#030409"
  night-glow: "#0C0E21"
  neutral-50: "#FAFAFA"
  neutral-100: "#F5F5F5"
  neutral-300: "#E5E5E5"
  neutral-600: "#737373"
  night-surface: "#18181B"
  night-border: "#27272A"
  night-muted: "#A1A1AA"
  indigo-900: "#352E82"
  indigo-700: "#333DA7"
  indigo-600: "#5160C3"
  indigo-500: "#6366F1"
  indigo-400: "#7388DF"
  indigo-300: "#8C9EE6"
  indigo-200: "#A5B4F0"
  indigo-150: "#A5B4FC"
  mark-green: "#00C37A"
  icon-violet: "#7D3DF3"
---

# PurpleInk Design System

## 1. System authority

PurpleInk's homepage is the visual source of truth. The design system is extracted from the shipped homepage; it does not redesign or normalize the homepage into a different aesthetic.

The normative implementation lives in `app/globals.css`. This document explains the intent and usage of those tokens. If documentation and the rendered homepage disagree, inspect the homepage implementation first and update the documentation or tokens without changing the rendered result.

## 2. Creative direction: Spectral Ink

PurpleInk combines a near-monochrome interface with indigo imagery that behaves like digital ink, light, or a moving photographic emulsion.

The visual character is:

- minimal and spatial rather than card-heavy;
- creative-technology rather than conventional SaaS;
- monochrome at the structural level;
- spectral indigo at expressive moments;
- tactile through blur, deformation, drag, parallax, and responsive motion;
- restrained in typography so imagery and interaction can carry the identity.

Black, white, and neutral gray create structure. Indigo is the dominant expressive hue family. The logo's green registration dot and the app icon's violet field are extracted brand-asset exceptions with deliberately narrow roles. New hues must not be introduced without first appearing on the reference homepage.

## 3. Token architecture

### Primitive tokens

Primitive tokens record exact colors extracted from the homepage. Components must not use primitive tokens directly unless they render a brand asset, gradient stop, or other value whose exact color is the intent.

| Family  | Tokens                                       | Purpose                                                         |
| ------- | -------------------------------------------- | --------------------------------------------------------------- |
| Neutral | `--pi-white`, `--pi-black`, `--pi-neutral-*` | Light surfaces, typography, borders, quiet grouping             |
| Night   | `--pi-night`, `--pi-night-*`                 | Dark theme, media stages, dark product surfaces                 |
| Indigo  | `--pi-indigo-*`                              | Brand spectrum, focus, actions, selected and highlighted states |
| Mark    | `--pi-mark-green`                            | Logo registration dot and verified state                        |
| Icon    | `--pi-icon-violet`                           | Static app-icon field only                                      |

The indigo sequence is intentionally extracted rather than mathematically regenerated. Do not replace it with a generic purple scale.

### Semantic tokens

Components consume semantic roles:

- `background` / `foreground`
- `muted` / `muted-foreground`
- `surface-strong`
- `border`
- `accent` / `accent-strong` / `accent-light` / `accent-foreground`
- `ink-panel` / `ink-panel-soft` / `ink-panel-text` / `ink-panel-muted`
- `proof` / `proof-ink`
- `signal` / `signal-soft` / `signal-ink`

`proof` and `signal` are product-state roles, not independent brand palettes. `proof` reuses the homepage logo green; `signal` is derived from indigo and neutral primitives. Both must always be accompanied by a label or icon.

### Brand-effect tokens

The homepage's effects are reusable brand assets:

- `--gradient-brand-spectrum`: the primary `#333DA7 → #7388DF` image treatment;
- `--gradient-footer-spectrum`: the multi-stop footer glow;
- `--gradient-edge-spectrum`: a directional edge fade;
- `--brand-launch-ink`: the deep indigo used by the launch interaction;
- `--mask-header-fade`: the fixed-navigation blur mask;
- `--shadow-launch-cta`: the homepage CTA elevation;
- overlay tokens for the existing hover and launch animation states.

Do not approximate these effects with new gradients or arbitrary opacity values inside components.

## 4. Color rules

1. Ordinary layouts use one neutral surface system and, when necessary, one indigo emphasis.
2. Indigo communicates brand, selection, focus, motion energy, and primary action.
3. Abstract imagery uses the shared spectral gradient so unrelated source images belong to one visual family.
4. Dark sections use the Night primitives rather than generic Tailwind zinc or slate colors.
5. Verified states may reuse the logo green. Other status differences use label, icon, weight, indigo, and surface treatment rather than introducing another hue family.
6. Business components use semantic classes such as `bg-accent` and `text-muted-foreground`; they do not reference hex values.
7. Static assets such as favicons may embed exact primitive hex values because CSS custom properties are unavailable there.

## 5. Typography

### Geist sans

Geist is the production family for headings, body copy, navigation, controls, and marketing text. Next.js self-hosts the font files and exposes them through `--font-geist-sans`. Chinese text falls back to PingFang SC, Microsoft YaHei, or Noto Sans CJK SC because Geist does not include complete CJK glyph coverage.

Use the existing Tailwind type scale and weights from the homepage as the starting hierarchy:

- Hero: responsive `text-4xl` through `text-7xl`, medium weight, tight tracking;
- Section statement: responsive `text-4xl` through `text-7xl`, medium weight;
- Section heading: `text-2xl` through `text-4xl`, medium weight;
- Body: `text-sm` through `text-lg`, normal or medium weight;
- Navigation and controls: medium weight with normal casing.

### Geist Mono

Geist Mono is reserved for compact technical information: identifiers, versions, timestamps, dimensions, hashes, machine states, and operational labels. It is not a decorative substitute for body copy. Chinese technical content falls back to Noto Sans Mono CJK SC or the platform monospace.

## 6. Component expression

### Launch CTA

The homepage launch CTA is a signature brand component:

- 64px height;
- full pill geometry;
- neutral foreground/background inversion;
- a circular trailing action area;
- `--shadow-launch-cta` at rest;
- deep-indigo ink expansion during launch.

This component does not define the geometry of every product button. Product controls may remain more compact while using the same color and type tokens.

### Media cards

- 12px corner radius;
- portrait-oriented imagery where appropriate;
- shared spectral color treatment;
- flat containment with subtle boundaries;
- WebGL or CSS deformation may enhance interaction without hiding content.

### Navigation

The marketing navigation uses a fixed, blend-aware treatment with a fading backdrop mask. Product navigation may use conventional surfaces, but it must consume the same neutral, indigo, and typography tokens.

## 7. Light and dark themes

Light mode is pure white with near-black text. Dark mode is the homepage Night system, not a color-inverted purple theme.

Theme changes remap semantic tokens. Brand spectrum primitives stay stable across themes so imagery retains its identity.

Avoid hardcoded `text-white`, `bg-black`, or zinc/slate values when a semantic token expresses the same intent. Blend-mode marketing elements are the exception when their behavior specifically depends on black or white compositing.

## 8. Motion and accessibility

Motion is part of PurpleInk's identity, but content remains available without it.

- Preserve the existing blur-to-focus entrance, scroll reveal, draggable rails, fluid cursor, and WebGL hover behavior.
- New motion should reuse existing timing and easing patterns before adding another motion vocabulary.
- Reduced-motion mode must remove or simplify motion without leaving content invisible or displaced.
- Focus remains visible and uses the semantic ring token.
- Body text and controls target WCAG 2.1 AA contrast.

## 9. Governance

When adding or changing a color or font:

1. Confirm the value already exists on the homepage or is required as a semantic mapping.
2. Add or reuse a primitive token.
3. Map it to a semantic or brand-effect token.
4. Use the semantic token in components.
5. Verify light mode, dark mode, focus, reduced motion, and responsive layouts.
6. Run a homepage screenshot comparison. A token-only refactor must produce no intentional visual difference.

The homepage remains the reference surface until a deliberate brand redesign explicitly replaces it.
