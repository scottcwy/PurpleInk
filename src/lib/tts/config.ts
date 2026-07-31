import { z } from "zod";

const listenHubEnvSchema = z.object({
  TTS_PROVIDER: z.literal("listenhub-flowspeech"),
  LISTENHUB_API_KEY: z.string().min(1),
  LISTENHUB_API_BASE_URL: z
    .url()
    .refine((value) => !value.endsWith("/"), "Base URL must not end with /"),
  LISTENHUB_TTS_ENDPOINT: z.literal("/v1/tts"),
  LISTENHUB_TTS_VOICE: z.string().min(1),
  LISTENHUB_TTS_RESPONSE_FORMAT: z.enum([
    "mp3",
    "opus",
    "aac",
    "flac",
    "wav",
    "pcm",
  ]),
});

const mimoEnvSchema = z.object({
  TTS_PROVIDER: z.literal("mimo"),
  CVC_MANAGED_MIMO_API_KEY: z.string().min(1),
  MIMO_BASE_URL: z
    .url()
    .refine((value) => !value.endsWith("/"), "Base URL must not end with /"),
  MIMO_TTS_MODEL: z.string().min(1),
  MIMO_TTS_VOICE: z.string().min(1).default("mimo_default"),
});

const ttsEnvSchema = z.discriminatedUnion("TTS_PROVIDER", [
  listenHubEnvSchema,
  mimoEnvSchema,
]);

export type TtsEnv = z.infer<typeof ttsEnvSchema>;

export function parseTtsEnv(
  environment: Record<string, string | undefined>
): TtsEnv {
  return ttsEnvSchema.parse(environment);
}

export function getTtsEnv(): TtsEnv {
  return parseTtsEnv(process.env);
}
