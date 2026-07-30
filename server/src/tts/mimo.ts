import type { TtsEnv } from "../../../src/lib/tts/config";

export type MimoSpeechConfig = Extract<TtsEnv, { TTS_PROVIDER: "mimo" }>;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const PROVIDER_TIMEOUT_MS = 45_000;

export async function synthesizeMimoSpeech(
  text: string,
  config: MimoSpeechConfig,
  fetchImpl: FetchLike = fetch
): Promise<ArrayBuffer> {
  const response = await fetchImpl(
    `${config.MIMO_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        "api-key": config.CVC_MANAGED_MIMO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.MIMO_TTS_MODEL,
        messages: [
          {
            role: "user",
            content: "请把下一条消息转换为自然流畅的语音。",
          },
          { role: "assistant", content: text },
        ],
        audio: {
          format: "wav",
          voice: config.MIMO_TTS_VOICE,
        },
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    }
  );
  if (!response.ok) {
    throw new Error(`MiMo TTS failed with status ${response.status}`);
  }

  const data = readAudioData(await response.json());
  const audio = Buffer.from(
    data.replace(/^data:audio\/[^;]+;base64,/, ""),
    "base64"
  );
  if (
    audio.length < 44 ||
    audio.toString("ascii", 0, 4) !== "RIFF" ||
    audio.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("MiMo TTS returned invalid WAV audio");
  }
  return audio.buffer.slice(
    audio.byteOffset,
    audio.byteOffset + audio.byteLength
  ) as ArrayBuffer;
}

function readAudioData(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.choices)) {
    throw new Error("MiMo TTS returned an invalid response");
  }
  const choice = body.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new Error("MiMo TTS returned an invalid response");
  }
  const audio = choice.message.audio;
  if (!isRecord(audio) || typeof audio.data !== "string" || !audio.data) {
    throw new Error("MiMo TTS returned an invalid response");
  }
  return audio.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
