import 'server-only'
import { z } from 'zod'
import type { ProceduralSfxMode } from '@purpleink/procedural-sfx'

const MAX_WEBSITE_VIDEO_BYTES = 1_073_741_824

const proceduralSfxResultSchema = z
  .object({
    mode: z.enum(['off', 'procedural']),
    status: z.enum([
      'applied',
      'omitted-off',
      'omitted-no-cues',
      'omitted-unsupported',
      'omitted-error',
    ]),
    generatorVersion: z.literal('procedural-sfx/1.0.0'),
    cueCount: z.number().int().nonnegative(),
    timingHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    cuePlanHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    waveformHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
    failureCode: z.literal('PROCEDURAL_SFX_MIX_FAILED').optional(),
  })
  .strict()

const enginePhaseSchema = z.enum([
  'queued',
  'capturing',
  'scripting',
  'synthesizing',
  'timing',
  'composing',
  'rendering',
  'verifying',
  'muxing',
  'done',
  'failed',
  'cancelled',
])

const engineJobSchema = z
  .object({
    id: z.string().min(1),
    requestId: z.string().min(1),
    origin: z.string().url(),
    status: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']),
    phase: enginePhaseSchema,
    durationSec: z.number().positive().nullable(),
    durationSource: z.enum(['request', 'output']).nullable(),
    elapsedSec: z.number().nonnegative().nullable(),
    checkPassed: z.boolean().nullable(),
    goldenVerified: z.boolean().nullable(),
    goldenCheckCount: z.number().int().nonnegative(),
    soundEffects: proceduralSfxResultSchema.nullable(),
    hasVideo: z.boolean(),
    videoUrl: z.string().nullable(),
    failure: z
      .object({ code: z.literal('ENGINE_JOB_FAILED') })
      .strict()
      .nullable(),
  })
  .strip()

const startResponseSchema = z
  .object({
    reused: z.boolean(),
    job: engineJobSchema,
  })
  .strip()

export type WebsiteEnginePhase = z.infer<typeof enginePhaseSchema>
export type WebsiteEngineJob = z.infer<typeof engineJobSchema>

export interface StartWebsiteEngineInput {
  requestId: string
  url: string
  name: string
  durationSec: number
  quality: 'draft' | 'standard' | 'high'
  soundEffects: ProceduralSfxMode
}

export class WebsiteEngineError extends Error {
  constructor(
    readonly code:
      | 'ENGINE_UNCONFIGURED'
      | 'ENGINE_UNAVAILABLE'
      | 'ENGINE_JOB_NOT_FOUND'
      | 'ENGINE_RESPONSE_INVALID'
      | 'ENGINE_VIDEO_INVALID',
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(code)
    this.name = 'WebsiteEngineError'
  }
}

interface WebsiteEngineClientOptions {
  origin?: string
  internalKey?: string
  fetcher?: typeof fetch
}

export class WebsiteEngineClient {
  private readonly origin: string
  private readonly internalKey: string
  private readonly fetcher: typeof fetch

  constructor(options: WebsiteEngineClientOptions = {}) {
    this.origin = normalizeOrigin(
      options.origin ?? process.env.BACKEND_ORIGIN ?? 'http://localhost:8787',
    )
    this.internalKey =
      options.internalKey ?? process.env.PURPLEINK_ENGINE_INTERNAL_KEY ?? ''
    this.fetcher = options.fetcher ?? fetch
    if (!this.internalKey) {
      throw new WebsiteEngineError('ENGINE_UNCONFIGURED', false)
    }
  }

  async start(
    input: StartWebsiteEngineInput,
  ): Promise<{ reused: boolean; job: WebsiteEngineJob }> {
    const response = await this.request('/internal/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: input.requestId,
        url: input.url,
        name: input.name,
        duration: input.durationSec,
        quality: input.quality,
        generation: 'auto',
        soundEffects: input.soundEffects,
      }),
    })
    return parseJson(response, startResponseSchema)
  }

  async getJob(jobId: string): Promise<WebsiteEngineJob> {
    const response = await this.request(
      `/internal/jobs/${encodeURIComponent(jobId)}`,
      undefined,
      true,
    )
    return parseJson(response, engineJobSchema)
  }

  async downloadVideo(jobId: string): Promise<Buffer> {
    const response = await this.request(
      `/internal/jobs/${encodeURIComponent(jobId)}/video`,
    )
    if (!response.headers.get('content-type')?.startsWith('video/mp4')) {
      throw new WebsiteEngineError('ENGINE_VIDEO_INVALID', false, response.status)
    }
    return readResponseBodyWithLimit(response, MAX_WEBSITE_VIDEO_BYTES)
  }

  async cancel(jobId: string): Promise<void> {
    await this.request(`/internal/jobs/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
    })
  }

  private async request(
    path: string,
    init?: RequestInit,
    missingJobIsRetryable = false,
  ): Promise<Response> {
    let response: Response
    try {
      response = await this.fetcher(`${this.origin}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.internalKey}`,
          ...init?.headers,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new WebsiteEngineError('ENGINE_UNAVAILABLE', true)
    }
    if (response.ok) return response
    if (response.status === 404 && missingJobIsRetryable) {
      throw new WebsiteEngineError('ENGINE_JOB_NOT_FOUND', true, 404)
    }
    throw new WebsiteEngineError(
      response.status >= 500 ? 'ENGINE_UNAVAILABLE' : 'ENGINE_RESPONSE_INVALID',
      response.status >= 500,
      response.status,
    )
  }
}

export async function readResponseBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new WebsiteEngineError('ENGINE_VIDEO_INVALID', false, response.status)
  }
  const declaredHeader = response.headers.get('content-length')
  if (declaredHeader !== null) {
    const declaredSize = Number(declaredHeader)
    if (
      !Number.isSafeInteger(declaredSize)
      || declaredSize < 0
      || declaredSize > maxBytes
    ) {
      throw new WebsiteEngineError('ENGINE_VIDEO_INVALID', false, response.status)
    }
  }
  if (!response.body) {
    throw new WebsiteEngineError('ENGINE_VIDEO_INVALID', false, response.status)
  }

  const chunks: Buffer[] = []
  const reader = response.body.getReader()
  let sizeBytes = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    sizeBytes += chunk.value.byteLength
    if (sizeBytes > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new WebsiteEngineError('ENGINE_VIDEO_INVALID', false, response.status)
    }
    chunks.push(Buffer.from(chunk.value))
  }
  if (sizeBytes === 0) {
    throw new WebsiteEngineError('ENGINE_VIDEO_INVALID', false, response.status)
  }
  return Buffer.concat(chunks, sizeBytes)
}

async function parseJson<T extends z.ZodType>(
  response: Response,
  schema: T,
): Promise<z.output<T>> {
  const body: unknown = await response.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new WebsiteEngineError('ENGINE_RESPONSE_INVALID', false, response.status)
  }
  return parsed.data
}

function normalizeOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new WebsiteEngineError('ENGINE_UNCONFIGURED', false)
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new WebsiteEngineError('ENGINE_UNCONFIGURED', false)
  }
  return url.origin
}
