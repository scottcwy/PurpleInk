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

Server render tasks generate one independent narration segment per visual
scene. The narration prompt uses structured product copy and scene kinds; it
does not use screenshot captions or asset paths. The synchronous render flow
is:

```text
VideoModel -> duration-budgeted narration script -> FlowSpeech
           -> ffprobe duration -> pad/tempo-fit fixed scene windows
           -> unchanged visual composition/render -> FFmpeg narration mux
```

The generated project stores `narration-plan.json`, `audio_meta.json`, segment
audio under `audio/segments/`, and the normalized `audio/narration.wav` track.
The visual `VideoModel`, scene timing, Agent/template input, and final video
duration remain unchanged. Short narration is padded with silence; narration
that exceeds its scene window is tempo-fitted in the audio layer before muxing.

The server and render CLI load the ignored root `.env.local`; ordinary web
routes do not parse TTS configuration. The browser never calls ListenHub and no
TTS secret is written to generated artifacts. A separate narration worker, R2
persistence, and long-video orchestration remain out of scope.

## Commit Boundary

The TTS configuration can be submitted independently with:

```text
config/tts.env.example
docs/configuration/tts.md
lib/tts/config.ts
tests/tts-config.test.ts
```

The repository-level `.env.example` intentionally contains no TTS settings.
