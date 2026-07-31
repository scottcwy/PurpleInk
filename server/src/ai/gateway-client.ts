import {
  workerAiErrorSchema,
  workerAiSuccessSchema,
  type WorkerAiRequest,
} from "../../../src/features/ai/worker-gateway-contract"
import { nextWorkerAiOperation } from "./job-context"

type ModelWorkload = Exclude<WorkerAiRequest["workload"], "website-tts">

export type WorkerModelContent =
  | { type: "text"; text: string }
  | {
      type: "image"
      source: { type: "base64"; media_type: string; data: string }
    }

export interface WorkerModelRequest {
  workload: ModelWorkload
  systemPrompt?: string
  content: WorkerModelContent[]
  maxOutputTokens: number
}

export interface WorkerTtsResult {
  audio: ArrayBuffer
  audioFormat: "mp3" | "wav"
  durationMs: number
}

const REQUEST_TIMEOUT_MS = 4 * 60_000

export async function callWorkerModel(
  input: WorkerModelRequest,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const capability = input.content.some((part) => part.type === "image")
    ? "vision"
    : "text"
  const result = await requestGateway({
    ...nextWorkerAiOperation(input.workload),
    capability,
    workload: input.workload,
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    content: input.content.map((part) => part.type === "text"
      ? part
      : {
          type: "image" as const,
          data: part.source.data,
          mimeType: imageMimeType(part.source.media_type),
        }),
    maxOutputTokens: input.maxOutputTokens,
  }, fetcher)
  if (result.capability === "tts") throw new Error("WORKER_AI_RESPONSE_INVALID")
  return result.text
}

export async function synthesizeWorkerSpeech(
  text: string,
  fetcher: typeof fetch = fetch,
): Promise<WorkerTtsResult> {
  const result = await requestGateway({
    ...nextWorkerAiOperation("website-tts"),
    capability: "tts",
    workload: "website-tts",
    text,
  }, fetcher)
  if (result.capability !== "tts") throw new Error("WORKER_AI_RESPONSE_INVALID")
  const bytes = Buffer.from(result.audioBase64, "base64")
  return {
    audio: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
    audioFormat: result.audioFormat,
    durationMs: result.durationMs,
  }
}

async function requestGateway(
  body: WorkerAiRequest,
  fetcher: typeof fetch,
) {
  const origin = gatewayOrigin()
  const internalKey = process.env.PURPLEINK_ENGINE_INTERNAL_KEY?.trim()
  if (!internalKey) throw new Error("WORKER_AI_GATEWAY_UNCONFIGURED")

  let response: Response
  try {
    response = await fetcher(`${origin}/api/internal/ai/worker`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${internalKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new Error("WORKER_AI_GATEWAY_UNAVAILABLE")
  }
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const failure = workerAiErrorSchema.safeParse(payload)
    throw new Error(failure.success ? failure.data.code : "WORKER_AI_GATEWAY_FAILED")
  }
  return workerAiSuccessSchema.parse(payload)
}

function gatewayOrigin(): string {
  const value = process.env.PURPLEINK_AI_GATEWAY_ORIGIN?.trim()
  if (!value) throw new Error("WORKER_AI_GATEWAY_UNCONFIGURED")
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("WORKER_AI_GATEWAY_UNCONFIGURED")
  }
  return url.origin
}

function imageMimeType(value: string): "image/png" | "image/jpeg" | "image/webp" {
  if (value === "image/png" || value === "image/jpeg" || value === "image/webp") {
    return value
  }
  throw new Error("WORKER_AI_IMAGE_TYPE_UNSUPPORTED")
}
