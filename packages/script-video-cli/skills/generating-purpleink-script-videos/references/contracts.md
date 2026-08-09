# PurpleInk CLI contracts

## Inputs

- Markdown: the first H1 supplies the title, but unit boundaries come from semantic INGEST rather than headings, character counts, punctuation counts, or fixed duration. Units continuously cover the source in order; each carries one core judgment and maps to one shot.
- JSON: schema version 1 with title, language, durationSec, visualStyle, optional globalPrompt, narration, and ordered `U###` units.
- WAV/MP3: FFmpeg supplies real segment boundaries; MiMo only transcribes text. AI may group adjacent segments semantically, while the program deterministically inherits their text and outer timestamps. The CLI writes `input/transcript.json`, `input/transcript.md`, and `input/script.json` before continuing.
- A run/plan/submit global Prompt file is copied into the run and appended only to DIRECT, SHOT-SPEC, FABRICATE, and HTML repair. It does not alter semantic ingest, ASR, transcript structure, or TTS.

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
