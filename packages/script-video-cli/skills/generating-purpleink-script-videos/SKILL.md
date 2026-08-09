---
name: generating-purpleink-script-videos
description: Operate the local PurpleInk Agent-first CLI to turn Markdown, JSON, WAV, or MP3 into narrated script videos; resolve global visual direction, merge visual guidance from other active Skills, run single or persistent batch jobs, diagnose and retry failed shots, locate artifacts, or open local browser observation.
---

# Generate PurpleInk script videos

Use the CLI as the source of truth. Run `purpleink-video --help` (or the repository's `pnpm cli --help`) before choosing flags; do not copy command syntax from memory.

## Resolve visual direction before running

Do not start, plan, or submit a video until the visual direction is resolved. Use the existing conversation first, then ask one compact question for any missing choices: global dark or light palette; flat, dimensional, or per-shot semantic choice; named visual style; and optional references.

If another active Skill describes code-video, animation, brand, or visual style, extract only its palette, typography, composition, dimensionality, material, camera, motion, effects, and visual prohibitions. Do not copy its commands, tools, frameworks, file layout, validation, testing, or release workflow. Explicit user choices override extracted style; extracted style overrides PurpleInk defaults.

Turn the resolved choices into one concise UTF-8 global Prompt. State explicit palette, dimensionality, and named-style choices as mandatory whole-video constraints. If the user delegates a choice to AI, state that freedom explicitly instead of inventing a hard lock. Pass this file through the global Prompt option shown by the current CLI help so DIRECT, every SHOT-SPEC, every FABRICATE call, and HTML repair receive the same constraints.

## Decision order

1. Resolve the visual direction and global Prompt as described above.
2. Run `config show --json`. If a profile is missing, ask the user for URL, Model ID, and a key through hidden input or `--key-stdin`. Never place keys in command arguments, files, logs, or chat output.
3. Read [references/contracts.md](references/contracts.md) when input, status, or artifact semantics matter.
4. For one input, run it in the foreground. WAV/MP3 may go directly to `run`; use `transcribe` only when the user wants the normalized transcript first.
5. For multiple inputs, start the daemon, submit the inputs, and watch status. Do not require PostgreSQL for a foreground run.
6. If status is `needs_attention`, inspect the run or shot, return the absolute HTML/screenshot/audio/diagnostic paths, then retry only `--failed` or the named shot.
7. Use `serve --port 0` when a human wants a browser view. Treat the returned loopback URL as temporary.
8. Report success only after `inspect --json` exposes an absolute final MP4 path and the final media metadata confirms the expected video/audio streams. A successful API call, queue job, or fixture run is not a delivered video.

## Safety boundaries

- Stay inside the local script-video workflow. Do not add accounts, billing, permissions, cloud storage, SaaS projects, Redis, or a workflow editor.
- Prefer JSON output and preserve every run directory for recovery.
- Do not expose provider errors, prompts, headers, credentials, or hidden reasoning.
- Do not claim narration exists when `--narration off` was used.
- Never read arbitrary local paths through the observer; use only artifacts registered in the run index.
