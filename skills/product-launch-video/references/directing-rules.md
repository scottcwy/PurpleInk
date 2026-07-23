# Directing Rules

## Evidence first

- Give each beat one primary claim and one primary capability.
- Open on a visible result or changed state, then add only the context needed to understand it.
- Bind each factual scene to at least one approved `NodeEvidence` entry whose `sceneIds` contains the scene.
- Use screenshots or clips exactly as supplied. Permit trim, normalized crop, normalized focus, scale, mask, and emphasis only.
- Never infer a metric, customer result, integration, workflow state, or UI not visible in the approved Evidence.

## Timing

- Use 3-5 beats totaling 15-30 seconds.
- Start the first beat at `0`; start every later beat at the exact end of the prior beat; end the final beat at `durationMs`.
- Prefer 3.5-6.5 seconds per beat. Give UI clips enough time for the relevant state change to be legible.
- Use a cursor or click beat only when the action is necessary to understand the demonstrated outcome.

## Copy

- Preserve storyboard meaning and use its approved language. Tighten wording without adding claims.
- Keep one short headline and, only when useful, one short body line.
- Obey the supplied `copyLimits` by Unicode character count.
- Do not add implementation jargon, generic AI claims, or tutorial instructions.

## Selection

- Select IDs only from `templateCapabilities`.
- Use layouts to serve the Evidence shape, not to decorate empty space.
- Vary motion presets with narrative purpose while keeping motion restrained.
- Use continuous transitions. The outgoing product state must remain visible until the transition begins.
- Use the BrandKit and PurpleInk semantic colors: purple for authorship/action, green for explicitly approved proof, coral only for required review.

## Output check

Reject the plan if any reference is missing, mutable, unapproved, redaction-blocked, cross-release, outside an allowed ID list, or inconsistent with the storyboard.
