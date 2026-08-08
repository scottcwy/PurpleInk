# PurpleInk CLI contracts

## Inputs

- Markdown: first H1 is the title; H2+ sections become ordered units.
- JSON: schema version 1 with title, language, durationSec, visualStyle, narration, and ordered `U###` units.
- WAV/MP3: FFmpeg supplies real segment boundaries; MiMo only transcribes text. The CLI writes `input/transcript.json`, `input/transcript.md`, and `input/script.json` before continuing.

## Run status

- `created` / `queued` / `running`: work is not complete.
- `needs_attention`: one or more shots or narrations failed; inspect and retry without discarding successful stages.
- `succeeded`: final media QA passed.
- `degraded`: a diagnostic bypass such as `--no-browser-gate` was used; do not present it as full visual acceptance.
- `failed` / `cancelled`: no successful final delivery.

## Artifacts

The authoritative allow-list is `<runDir>/artifacts/index.json`. Important IDs include:

- `shot-S001-plan`, `shot-S001-html`, three `shot-S001-screenshot-*` entries, diagnostics, and narration;
- transcript and normalized-input artifacts for audio sources;
- `project-manifest`, `subtitles`, and `visual-render`;
- `video` and three `final-frame-*` artifacts.

Return `absolutePath` values from this index or from `inspect --json`. The final `video` entry must include real byte size, SHA-256, and media metadata.
