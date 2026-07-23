# PurpleInk Color System

PurpleInk's color system is extracted directly from the production homepage. The implementation source is `app/globals.css`; this document records the palette, mapping, and governance rules.

## Palette

### Neutral structure

| Token              | Value     | Role                                                |
| ------------------ | --------- | --------------------------------------------------- |
| `pi-white`         | `#FFFFFF` | Light background and inverted text                  |
| `pi-black`         | `#0A0A0A` | Primary light-theme text                            |
| `pi-neutral-50`    | `#FAFAFA` | Dark-theme foreground                               |
| `pi-neutral-100`   | `#F5F5F5` | Muted light surface                                 |
| `pi-neutral-300`   | `#E5E5E5` | Light border and strong surface                     |
| `pi-neutral-600`   | `#737373` | Muted light-theme text                              |
| `pi-night`         | `#03040A` | Dark background and media stage                     |
| `pi-night-asset`   | `#030409` | Exact darkest stop in the homepage gradient asset   |
| `pi-night-glow`    | `#0C0E21` | Near-black glow stop in the homepage gradient asset |
| `pi-night-surface` | `#18181B` | Dark grouped surface                                |
| `pi-night-border`  | `#27272A` | Dark boundaries                                     |
| `pi-night-muted`   | `#A1A1AA` | Muted dark-theme text                               |

### Spectral indigo

| Token           | Value     | Homepage source                        |
| --------------- | --------- | -------------------------------------- |
| `pi-indigo-900` | `#352E82` | Launch CTA ink expansion and fluid ink |
| `pi-indigo-700` | `#333DA7` | Spectral gradient start                |
| `pi-indigo-600` | `#5160C3` | Footer spectrum stop                   |
| `pi-indigo-500` | `#6366F1` | Focus and primary accent               |
| `pi-indigo-400` | `#7388DF` | Spectral gradient end                  |
| `pi-indigo-300` | `#8C9EE6` | Footer spectrum stop                   |
| `pi-indigo-200` | `#A5B4F0` | Footer spectrum stop and quiet state   |
| `pi-indigo-150` | `#A5B4FC` | Light accent surface                   |

### Restricted brand-asset colors

| Token            | Value     | Rule                                          |
| ---------------- | --------- | --------------------------------------------- |
| `pi-mark-green`  | `#00C37A` | Logo registration dot and verified state only |
| `pi-icon-violet` | `#7D3DF3` | Static favicon/app-icon field only            |

These values are intentionally extracted from the homepage. They are not a generated purple scale and should not be replaced by ColorBox output without a deliberate homepage redesign.

## Semantic mapping

| Semantic role      | Light       | Dark          |
| ------------------ | ----------- | ------------- |
| `background`       | White       | Night         |
| `foreground`       | Black       | Neutral 50    |
| `muted`            | Neutral 100 | Night Surface |
| `muted-foreground` | Neutral 600 | Night Muted   |
| `border`           | Neutral 300 | Night Border  |
| `accent`           | Indigo 500  | Indigo 500    |
| `accent-strong`    | Indigo 900  | Indigo 150    |
| `accent-light`     | Indigo 150  | Indigo 700    |
| `ink-panel`        | Night       | Night         |

Product states such as approved, pending, failed, and review-required are semantic roles within this palette. Approved/verified may reuse the logo green. Other states use indigo, neutral surfaces, text, and icons rather than adding orange, red, or another independent family.

## Brand effects

The following effects are part of the palette system because they recur across the homepage:

- primary spectral image overlay;
- footer multi-stop spectrum;
- directional spectrum fade;
- deep-indigo launch ink;
- black and white interaction overlays;
- launch CTA shadow;
- header fade mask.

Components consume the shared CSS variables instead of reconstructing these effects locally.

## Usage rules

- Use semantic tokens in application components.
- Use primitive tokens only when an exact brand color is the content.
- Use the spectral gradient for homepage-style media treatment.
- Do not add a hue merely to distinguish a state; add an icon, label, or structural change first.
- Do not use generic Tailwind color families when the neutral or indigo system already covers the role.
- Static SVG/app icons may embed the exact primitive hex values.
- Any token-only refactor must be checked against a homepage screenshot and should introduce no intentional visual difference.

## ColorBox status

`docs/colorbox-import.json` now provides four homepage-aligned candidate ramps: Spectral Indigo, Neutral, Night Ink, and restricted Proof Green. Each ramp locks one production Hex because ColorBox supports one lock per ramp.

ColorBox output is supplementary, not normative. Preserve every extracted homepage value above after export; use generated values only to fill a documented tonal gap. The exact workflow and anchor-replacement table live in `docs/PURPLEINK_DESIGN_SYSTEM_FEISHU.md`.
