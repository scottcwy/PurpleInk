---
name: generating-purpleink-script-videos
description: Operate the local PurpleInk Agent-first CLI to turn Markdown, JSON, WAV, or MP3 into narrated script videos; use for single runs, persistent batch submission, ASR transcription, failed-shot diagnosis and retry, artifact path lookup, or local browser observation.
---

# Generate PurpleInk script videos

Use the CLI as the source of truth. Run `purpleink-video --help` (or the repository's `pnpm cli --help`) before choosing flags; do not copy command syntax from memory.

## Decision order

1. Run `config show --json`. If a profile is missing, ask the user for URL, Model ID, and a key through hidden input or `--key-stdin`. Never place keys in command arguments, files, logs, or chat output.
2. Read [references/contracts.md](references/contracts.md) when input, status, or artifact semantics matter.
3. For one input, run it in the foreground. WAV/MP3 may go directly to `run`; use `transcribe` only when the user wants the normalized transcript first.
4. For multiple inputs, start the daemon, submit the inputs, and watch status. Do not require PostgreSQL for a foreground run.
5. If status is `needs_attention`, inspect the run or shot, return the absolute HTML/screenshot/audio/diagnostic paths, then retry only `--failed` or the named shot.
6. Use `serve --port 0` when a human wants a browser view. Treat the returned loopback URL as temporary.
7. Report success only after `inspect --json` exposes an absolute final MP4 path and the final media metadata confirms the expected video/audio streams. A successful API call, queue job, or fixture run is not a delivered video.

## Safety boundaries

- Stay inside the local script-video workflow. Do not add accounts, billing, permissions, cloud storage, SaaS projects, Redis, or a workflow editor.
- Prefer JSON output and preserve every run directory for recovery.
- Do not expose provider errors, prompts, headers, credentials, or hidden reasoning.
- Do not claim narration exists when `--narration off` was used.
- Never read arbitrary local paths through the observer; use only artifacts registered in the run index.
