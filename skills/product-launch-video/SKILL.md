---
name: product-launch-video
description: Direct approved PurpleInk release storyboards and immutable product Evidence into a schema-valid LaunchVideoPlanV1. Use when planning a 15-30 second Feature Launch video, selecting allowlisted layouts, motion presets, transitions, crops, and evidence for a verified product release. Return JSON only; never author or execute HTML, CSS, JavaScript, shell commands, dependencies, or external URLs.
---

# Product Launch Video

Create only a `LaunchVideoPlanV1` JSON object. Treat every other output format as a failure.

## Workflow

1. Read the complete input object only after the Runner has accepted it with `scripts/validate-input.mjs`.
2. Read [directing-rules.md](references/directing-rules.md) and [linear-feature-launch.md](references/linear-feature-launch.md).
3. Select only capability, layout, motion, and transition IDs present in `templateCapabilities`.
4. Build 3-5 contiguous beats totaling 15-30 seconds. Bind every factual scene to approved Evidence from the same release.
5. Preserve product truth. Crop, focus, trim, and sequence Evidence; never redraw or invent product UI, facts, metrics, customers, or outcomes.
6. Emit the plan as raw JSON with no Markdown fence or commentary.
7. Return the JSON to the Runner for `scripts/validate-output.mjs` validation. Do not invoke the script or any shell command yourself.

## Hard Boundary

- Output exactly the properties allowed by [launch-video-plan-v1.schema.json](schemas/launch-video-plan-v1.schema.json).
- Never emit or execute HTML, CSS, JavaScript, shell, package manifests, dependencies, or external URLs.
- Treat bundled validation scripts as Runner entry points, not Agent tools.
- Never retrieve product pages or operate a browser. Consume only the supplied immutable records and Evidence.
- Never use an ID from another workspace, product, or release.
- Never reference Evidence or assets unless both are approved, immutable, hash-locked, and present in the input package.
- Never invent a capability ID, layout ID, motion preset ID, transition ID, or template parameter.
- Do not decide output aspect ratio, quality, or language; those belong to the render job.

## Contracts

- Input schema: [input-v1.schema.json](schemas/input-v1.schema.json)
- Output schema: [launch-video-plan-v1.schema.json](schemas/launch-video-plan-v1.schema.json)
- Directing policy: [directing-rules.md](references/directing-rules.md)
- Template reference: [linear-feature-launch.md](references/linear-feature-launch.md)
- Compiler boundary: [hyperframes-contract.md](references/hyperframes-contract.md)
