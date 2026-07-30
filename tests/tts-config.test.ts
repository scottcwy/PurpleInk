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

  it("accepts an explicitly selected managed MiMo worker configuration", () => {
    expect(
      parseTtsEnv({
        TTS_PROVIDER: "mimo",
        CVC_MANAGED_MIMO_API_KEY: "test-mimo-key",
        MIMO_BASE_URL: "https://api.xiaomimimo.com/v1",
        MIMO_TTS_MODEL: "mimo-v2.5-tts",
        MIMO_TTS_VOICE: "mimo_default",
      })
    ).toEqual({
      TTS_PROVIDER: "mimo",
      CVC_MANAGED_MIMO_API_KEY: "test-mimo-key",
      MIMO_BASE_URL: "https://api.xiaomimimo.com/v1",
      MIMO_TTS_MODEL: "mimo-v2.5-tts",
      MIMO_TTS_VOICE: "mimo_default",
    });
  });

  it("rejects MiMo worker configuration without the managed key", () => {
    expect(() =>
      parseTtsEnv({
        TTS_PROVIDER: "mimo",
        MIMO_BASE_URL: "https://api.xiaomimimo.com/v1",
        MIMO_TTS_MODEL: "mimo-v2.5-tts",
        MIMO_TTS_VOICE: "mimo_default",
      })
    ).toThrow(/CVC_MANAGED_MIMO_API_KEY/);
  });
});
