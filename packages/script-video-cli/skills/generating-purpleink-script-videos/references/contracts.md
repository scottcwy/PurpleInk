# PurpleInk CLI contracts

## Inputs

- Markdown: the first H1 supplies the title, but unit boundaries come from semantic INGEST rather than headings, character counts, punctuation counts, or fixed duration. Units continuously cover the source in order; each carries one core judgment and maps to one shot.
- JSON: schema version 1 with title, language, durationSec, visualStyle, optional globalPrompt, narration, and ordered `U###` units.
- WAV/MP3: FFmpeg supplies real segment boundaries; MiMo only transcribes text. AI may group adjacent segments semantically, while the program deterministically inherits their text and outer timestamps. The CLI writes `input/transcript.json`, `input/transcript.md`, and `input/script.json` before continuing.
- A run/plan/submit global Prompt file is copied into the run and appended only to DIRECT, SHOT-SPEC, FABRICATE, and HTML repair. It does not alter semantic ingest, ASR, transcript structure, or TTS.

## Run status

- `created` / `queued` / `running`: work is not complete.
- `needs_attention`: one or more shots or narrations failed; inspect and retry without discarding successful stages.
- `awaiting_agent_review`: the video execution chain reached its end and produced a final MP4; tell the user its absolute path, then continue Agent acceptance.
- `succeeded`: a non-video command completed, or an older video run reached the end of its execution chain. It is not video delivery acceptance.
- `degraded`: retained for compatibility with older runs; it is not delivery acceptance.
- `failed` / `cancelled`: no successful final delivery.

HyperFrames findings, composition errors, ffprobe differences, and final-frame extraction are advisory observations in the CLI. The Agent Skill decides whether the final MP4 is acceptable and owns diagnosis and retry.

## Artifacts

The authoritative allow-list is `<runDir>/artifacts/index.json`. Important IDs include:

- `shot-S001-plan`, `shot-S001-html`, optional legacy screenshots, diagnostics, and narration;
- transcript and normalized-input artifacts for audio sources;
- `project-manifest`, `subtitles`, and `visual-render`;
- `video` and optional advisory `final-frame-*` artifacts.

Return `absolutePath` values from this index or from `inspect --json`. Final acceptance evidence belongs under `final/qa/<video-sha256>/` and must be regenerated from the current final MP4 after every repair.
