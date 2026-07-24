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
    }
  );

  if (!response.ok) {
    throw new Error(`FlowSpeech TTS failed with status ${response.status}`);
  }

  return response.arrayBuffer();
}
