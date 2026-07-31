import { createHash } from "node:crypto"
import type { RenderRequest } from "./job-runner"
import {
  validatePublicUrl,
  type PublicDnsResolver,
} from "../security/public-url-policy"

export type InternalRequestCode =
  | "INTERNAL_BODY_INVALID"
  | "INTERNAL_REQUEST_ID_REQUIRED"
  | "INTERNAL_URL_REQUIRED"
  | "INTERNAL_FIELD_FORBIDDEN"
  | "INTERNAL_FIELD_INVALID"

export class InternalRenderRequestError extends Error {
  constructor(readonly code: InternalRequestCode) {
    super(code)
    this.name = "InternalRenderRequestError"
  }
}

export interface NormalizedInternalRenderRequest extends RenderRequest {
  requestId: string
  workspaceId: string
  attemptId: string
  url: string
  capture: NonNullable<RenderRequest["capture"]> & {
    credentialMode: "none"
    publicOnly: true
  }
}

const ALLOWED_FIELDS = new Set([
  "requestId",
  "workspaceId",
  "attemptId",
  "url",
  "duration",
  "name",
  "quality",
  "refresh",
  "fps",
  "generation",
  "soundEffects",
])

export async function normalizeInternalRenderRequest(
  input: unknown,
  resolveDns?: PublicDnsResolver
): Promise<NormalizedInternalRenderRequest> {
  if (!isRecord(input)) throw new InternalRenderRequestError("INTERNAL_BODY_INVALID")

  const requestId = normalizeRequestId(input.requestId)
  const workspaceId = normalizeUuid(input.workspaceId)
  const attemptId = normalizeUuid(input.attemptId)
  if (typeof input.url !== "string" || input.url.trim().length === 0) {
    throw new InternalRenderRequestError("INTERNAL_URL_REQUIRED")
  }
  for (const key of Object.keys(input)) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new InternalRenderRequestError("INTERNAL_FIELD_FORBIDDEN")
    }
  }

  const url = await validatePublicUrl(input.url.trim(), resolveDns)
  const duration = optionalInteger(input.duration, 5, 120)
  const fps = optionalInteger(input.fps, 12, 60)
  const name = optionalName(input.name)
  const quality = optionalEnum(input.quality, ["draft", "standard", "high"] as const)
  const generation = optionalEnum(input.generation, ["llm", "template", "auto"] as const)
  const refresh = optionalBoolean(input.refresh)
  const soundEffects = optionalEnum(input.soundEffects, ["off", "procedural"] as const)

  return {
    requestId,
    workspaceId,
    attemptId,
    url,
    ...(duration !== undefined ? { duration } : {}),
    ...(fps !== undefined ? { fps } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(quality !== undefined ? { quality } : {}),
    ...(generation !== undefined ? { generation } : {}),
    ...(refresh !== undefined ? { refresh } : {}),
    soundEffects: soundEffects ?? "off",
    capture: { credentialMode: "none", publicOnly: true },
  }
}

export function fingerprintInternalRenderRequest(
  request: NormalizedInternalRenderRequest
): string {
  const stableInput = {
    url: request.url,
    duration: request.duration ?? null,
    fps: request.fps ?? null,
    name: request.name ?? null,
    quality: request.quality ?? null,
    generation: request.generation ?? null,
    refresh: request.refresh ?? null,
    soundEffects: request.soundEffects ?? "off",
    workspaceId: request.workspaceId,
    attemptId: request.attemptId,
    credentialMode: "none",
    publicOnly: true,
  }
  return createHash("sha256").update(JSON.stringify(stableInput)).digest("hex")
}

function normalizeUuid(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
  ) {
    throw new InternalRenderRequestError("INTERNAL_FIELD_INVALID")
  }
  return value
}

function normalizeRequestId(value: unknown): string {
  if (typeof value !== "string") {
    throw new InternalRenderRequestError("INTERNAL_REQUEST_ID_REQUIRED")
  }
  const normalized = value.trim()
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)
  ) {
    throw new InternalRenderRequestError("INTERNAL_REQUEST_ID_REQUIRED")
  }
  return normalized
}

function optionalInteger(
  value: unknown,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === undefined) return undefined
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new InternalRenderRequestError("INTERNAL_FIELD_INVALID")
  }
  return value
}

function optionalName(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    throw new InternalRenderRequestError("INTERNAL_FIELD_INVALID")
  }
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 120) {
    throw new InternalRenderRequestError("INTERNAL_FIELD_INVALID")
  }
  return normalized
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") {
    throw new InternalRenderRequestError("INTERNAL_FIELD_INVALID")
  }
  return value
}

function optionalEnum<const T extends readonly string[]>(
  value: unknown,
  values: T
): T[number] | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !values.includes(value)) {
    throw new InternalRenderRequestError("INTERNAL_FIELD_INVALID")
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
