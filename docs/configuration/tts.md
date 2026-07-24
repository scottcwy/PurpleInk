# TTS Configuration

PurpleInk currently selects ListenHub FlowSpeech for narration synthesis. TTS
configuration is parsed independently from the web application's database and
authentication environment so ordinary web routes do not require TTS secrets.

## Current Selection

| Setting         | Value                             |
| --------------- | --------------------------------- |
| Provider        | `listenhub-flowspeech`            |
| API base URL    | `https://api.marswave.ai/openapi` |
| Endpoint        | `/v1/tts`                         |
| Voice           | `振松` (`nanzhongyin-4897116a`)   |
| Response format | `mp3`                             |

FlowSpeech does not expose a model selector on this endpoint. Do not add a
`model` variable: the stable integration contract is the provider and endpoint.

## Local Secret

Use [`config/tts.env.example`](../../config/tts.env.example) as the public
template and put the real `LISTENHUB_API_KEY` plus the other TTS values in the
ignored `.env.local` file. Application code must read the configuration through
`getTtsEnv()` from `lib/tts/config.ts`.

## Runtime Boundary

`POST /v1/tts` accepts one voice and returns binary audio. A narration worker
must check the HTTP status and `Content-Type`, download the bytes immediately,
normalize them with FFmpeg, and persist the resulting immutable asset in R2.
The Director and browser must not call ListenHub directly.

This change defines and validates the configuration boundary only. The
narration worker and long-video orchestration are separate implementation work.

## Commit Boundary

The TTS configuration can be submitted independently with:

```text
config/tts.env.example
docs/configuration/tts.md
lib/tts/config.ts
tests/tts-config.test.ts
```

The repository-level `.env.example` intentionally contains no TTS settings.
