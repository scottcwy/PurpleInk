export interface FlowSpeechConfig {
  TTS_PROVIDER: "listenhub-flowspeech";
  LISTENHUB_API_KEY: string;
  LISTENHUB_API_BASE_URL: string;
  LISTENHUB_TTS_ENDPOINT: "/v1/tts";
  LISTENHUB_TTS_VOICE: string;
  LISTENHUB_TTS_RESPONSE_FORMAT:
    | "mp3"
    | "opus"
    | "aac"
    | "flac"
    | "wav"
    | "pcm";
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type FlowSpeechFormat = FlowSpeechConfig["LISTENHUB_TTS_RESPONSE_FORMAT"];
const PROVIDER_TIMEOUT_MS = 45_000;

export async function synthesizeFlowSpeech(
  text: string,
  config: FlowSpeechConfig,
  fetchImpl: FetchLike = fetch
): Promise<ArrayBuffer> {
  const response = await fetchImpl(
    `${config.LISTENHUB_API_BASE_URL}${config.LISTENHUB_TTS_ENDPOINT}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.LISTENHUB_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: text,
        voice: config.LISTENHUB_TTS_VOICE,
        response_format: config.LISTENHUB_TTS_RESPONSE_FORMAT,
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    }
  );

  if (!response.ok) {
    throw new Error(`FlowSpeech TTS failed with status ${response.status}`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("json") || looksLikeJson(audio)) {
    const code = readProviderCode(audio);
    throw new Error(
      code === undefined
        ? "FlowSpeech TTS returned an invalid response"
        : `FlowSpeech TTS failed with provider code ${code}`
    );
  }
  if (!matchesAudioFormat(audio, config.LISTENHUB_TTS_RESPONSE_FORMAT)) {
    throw new Error(
      `FlowSpeech TTS returned invalid ${config.LISTENHUB_TTS_RESPONSE_FORMAT} audio`
    );
  }

  return audio.buffer.slice(
    audio.byteOffset,
    audio.byteOffset + audio.byteLength
  ) as ArrayBuffer;
}

function looksLikeJson(bytes: Buffer): boolean {
  const first = bytes.toString("utf8", 0, Math.min(bytes.length, 32)).trimStart()[0];
  return first === "{" || first === "[";
}

function readProviderCode(bytes: Buffer): number | undefined {
  try {
    const body: unknown = JSON.parse(bytes.toString("utf8"));
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return undefined;
    }
    return typeof (body as { code?: unknown }).code === "number"
      ? (body as { code: number }).code
      : undefined;
  } catch {
    return undefined;
  }
}

function matchesAudioFormat(bytes: Buffer, format: FlowSpeechFormat): boolean {
  switch (format) {
    case "mp3":
      return isId3(bytes) || isMpegFrame(bytes);
    case "wav":
      return hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WAVE");
    case "flac":
      return hasAscii(bytes, 0, "fLaC");
    case "opus":
      return hasAscii(bytes, 0, "OggS") && bytes.indexOf("OpusHead", 4, "ascii") >= 0;
    case "aac":
      return isId3(bytes) || isAdtsFrame(bytes);
    case "pcm":
      return bytes.length >= 2 && bytes.length % 2 === 0;
  }
}

function hasAscii(bytes: Buffer, offset: number, value: string): boolean {
  return bytes.length >= offset + value.length
    && bytes.toString("ascii", offset, offset + value.length) === value;
}

function isId3(bytes: Buffer): boolean {
  return hasAscii(bytes, 0, "ID3");
}

function isMpegFrame(bytes: Buffer): boolean {
  const second = bytes[1];
  return bytes[0] === 0xff
    && second !== undefined
    && (second & 0xe0) === 0xe0
    && (second & 0x18) !== 0x08
    && (second & 0x06) !== 0;
}

function isAdtsFrame(bytes: Buffer): boolean {
  const second = bytes[1];
  return bytes[0] === 0xff
    && second !== undefined
    && (second & 0xf6) === 0xf0;
}
