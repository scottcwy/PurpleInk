---
name: generating-purpleink-script-videos
description: Operate the local PurpleInk Agent-first CLI to turn Markdown, JSON, WAV, or MP3 into narrated script videos; resolve global visual direction, merge visual guidance from other active Skills, run single or persistent batch jobs, diagnose and retry failed shots, locate artifacts, or open local browser observation.
---

# Generate PurpleInk script videos

Use the CLI as the source of truth. Run `purpleink-video --help` (or the repository's `pnpm cli --help`) before choosing flags; do not copy command syntax from memory.

## Analyze and confirm visual direction before running

Do not start, plan, or submit a video immediately after receiving the manuscript. First infer its subject, audience, emotional arc, information density, narrative rhythm, and most important visual objects. Recommend one coherent whole-video direction: dark or light palette and color duties; flat, dimensional, or per-shot semantic dimensionality; named visual language; primary motion language; and visual prohibitions. Give one concise reason tied to the manuscript, then ask one compact confirmation even when the user supplied only part of the direction. If the user explicitly says to proceed without confirmation or delegates all visual choices to the Agent, treat that as confirmation and continue without another pause.

If another active Skill describes code-video, animation, brand, or visual style, extract only its palette, typography, composition, dimensionality, material, camera, motion, effects, and visual prohibitions. Do not copy its commands, tools, frameworks, file layout, validation, testing, or release workflow. Explicit user choices override extracted style; extracted style overrides PurpleInk defaults.

Turn the confirmed choices into one concise UTF-8 global Prompt. State explicit palette, dimensionality, named-style, motion, and prohibition choices as mandatory whole-video constraints. Add a factual boundary: meaningful names, numbers, dates, times, amounts, metrics, file sizes, people counts, message states, and claimed outcomes must come from the source; decorative UI must use neutral labels, skeleton content, or an explicit “示意” marker. If the user delegates a choice to AI, state that freedom explicitly instead of inventing a hard lock. Pass this file through the global Prompt option shown by the current CLI help so DIRECT, every SHOT-SPEC, every FABRICATE call, and HTML repair receive the same constraints.

## Decision order

1. Resolve the visual direction and global Prompt as described above.
2. Run `config show --json`. If a profile is missing, ask the user for URL, Model ID, and a key through hidden input or `--key-stdin`. Never place keys in command arguments, files, logs, or chat output.
3. Read [references/contracts.md](references/contracts.md) when input, status, or artifact semantics matter.
4. For one input, run it in the foreground. WAV/MP3 may go directly to `run`; use `transcribe` only when the user wants the normalized transcript first.
5. For multiple inputs, start the daemon, submit the inputs, and watch status. Do not require PostgreSQL for a foreground run.
6. If status is `needs_attention`, inspect the run or shot, return the absolute HTML/audio/diagnostic paths, then retry only `--failed` or the named shot.
7. Use `serve --port 0` when a human wants a browser view. Treat the returned loopback URL as temporary.
8. For a video run, expect `awaiting_agent_review` after the MP4 is assembled. Legacy video runs may still say `succeeded`; neither status is delivery acceptance. Always perform the final MP4 acceptance below before reporting delivery.

## Final MP4 acceptance

The Skill is the only delivery acceptance layer. The CLI deliberately keeps HyperFrames findings, composition errors, media observations, and frame extraction advisory so that an Agent can inspect the fullest possible result and decide the recovery path.

1. Locate the run, `artifacts/index.json`, `project/manifest.json`, logs, and the final `video` artifact. Never substitute `visual-render`, source HTML, or standalone screenshots for the final MP4.
2. If no final MP4 exists, inspect the last completed stage and safe logs, repair the execution problem, and resume or retry. Do not claim delivery.
3. As soon as a final MP4 exists, send the user a concise progress update containing its absolute path and state that it is awaiting Agent review. This lets the user watch it immediately; continue acceptance without pausing for a reply.
4. Run ffprobe yourself and verify that the MP4 can be read. Record its streams, codecs, dimensions, frame rate, duration, byte size, SHA-256, and absolute path. CLI media observations are clues, not acceptance.
5. Extract frames continuously across the complete final MP4 and generate contact sheets with absolute timestamps. For videos up to two minutes, default to one frame per second. For two to ten minutes, start around every two to five seconds; for ten to thirty minutes, around every five to ten seconds; for longer videos, choose `duration / target frame count`. Keep each sheet near 60–100 frames and split long videos into contiguous time ranges with no gaps.
6. In addition to uniform sampling, use the manifest to guarantee at least one midpoint frame for every shot. Add the midpoint whenever a shot is shorter than, or missed by, the uniform interval.
7. Check every sheet for white or black frames, freezes, repeated frames, missing content, unreadable text, clipping, and obvious layout failures. Compare each shot at 0%, 25%, 50%, 75%, and 100%: a moving background particle does not excuse a frozen main visual, and the main visual must make at least two meaningful state advances. If a range is suspicious, resample only that range every 0.2–0.5 seconds and map its absolute timestamps back to the responsible shot.
8. Compare meaningful visible text with the source units and shot facts. Reject invented names, numbers, dates, times, amounts, metrics, file sizes, people counts, message states, or claimed outcomes; neutral skeletons and explicit “示意” labels are allowed.
9. Inspect the named shot, then use the current CLI help to retry only that shot or repair the workflow code. Preserve successful shots, narration, and existing attempts. Do not regenerate successful TTS for a FABRICATE failure; if the same mechanism fails twice, diagnose it instead of blindly requesting more AI output.
10. After any repair, inspect the newly rendered final MP4 again. Old contact sheets never prove a new MP4. Perform both the dense suspicious-range check and a complete low-density pass before reporting success.

Save acceptance evidence under `<runDir>/final/qa/<video-sha256>/`. Contact-sheet names must include a batch number and absolute start/end timestamps; every cell must display its absolute MP4 time. A temporary FFmpeg script is allowed for this Agent task, but do not turn dense contact-sheet review into a permanent CLI workflow stage.

Return the final MP4, contact sheets, ffprobe summary, SHA-256, and their absolute paths. An API response, queue result, CLI `succeeded`, fixture, or existence of an MP4 alone is not a delivered video.

## Safety boundaries

- Stay inside the local script-video workflow. Do not add accounts, billing, permissions, cloud storage, SaaS projects, Redis, or a workflow editor.
- Prefer JSON output and preserve every run directory for recovery.
- Preserve final QA evidence by MP4 hash so evidence from an older render cannot be mistaken for the current video.
- Do not expose provider errors, prompts, headers, credentials, or hidden reasoning.
- Do not claim narration exists when `--narration off` was used.
- Never read arbitrary local paths through the observer; use only artifacts registered in the run index.
