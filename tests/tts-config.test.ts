import { describe, expect, it } from "vitest";
import { parseTtsEnv } from "../src/lib/tts/config";

const validTtsEnv = {
  TTS_PROVIDER: "listenhub-flowspeech",
  LISTENHUB_API_KEY: "test-listenhub-key",
  LISTENHUB_API_BASE_URL: "https://api.marswave.ai/openapi",
  LISTENHUB_TTS_ENDPOINT: "/v1/tts",
  LISTENHUB_TTS_VOICE: "nanzhongyin-4897116a",
  LISTENHUB_TTS_RESPONSE_FORMAT: "mp3",
};

describe("TTS environment", () => {
  it("accepts the ListenHub FlowSpeech configuration", () => {
    expect(parseTtsEnv(validTtsEnv)).toEqual(validTtsEnv);
  });

  it("rejects a missing ListenHub API key", () => {
    expect(() =>
      parseTtsEnv({ ...validTtsEnv, LISTENHUB_API_KEY: undefined })
    ).toThrow(/LISTENHUB_API_KEY/);
  });

  it("rejects a FlowSpeech endpoint with a different request contract", () => {
    expect(() =>
      parseTtsEnv({
        ...validTtsEnv,
        LISTENHUB_TTS_ENDPOINT: "/v1/speech",
      })
    ).toThrow(/LISTENHUB_TTS_ENDPOINT/);
  });
});
