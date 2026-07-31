import { z } from 'zod'

export const WORKER_AI_WORKLOADS = [
  'website-capture',
  'website-asset-description',
  'website-narration-script',
  'website-compose',
  'website-tts',
] as const

const identity = {
  workspaceId: z.string().uuid(),
  attemptId: z.string().uuid(),
  operationId: z.string().min(1).max(180)
    .regex(/^[A-Za-z0-9._:-]+$/),
  operationIndex: z.number().int().min(1).max(4_999),
}

const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1).max(1_000_000),
}).strict()

const imagePartSchema = z.object({
  type: z.literal('image'),
  data: z.string().min(1).max(25_000_000),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
}).strict()

const modelRequestSchema = z.object({
  ...identity,
  capability: z.enum(['text', 'vision']),
  workload: z.enum([
    'website-capture',
    'website-asset-description',
    'website-narration-script',
    'website-compose',
  ]),
  systemPrompt: z.string().max(100_000).optional(),
  content: z.array(z.discriminatedUnion('type', [
    textPartSchema,
    imagePartSchema,
  ])).min(1).max(64),
  maxOutputTokens: z.number().int().min(1).max(131_072),
}).strict()

const ttsRequestSchema = z.object({
  ...identity,
  capability: z.literal('tts'),
  workload: z.literal('website-tts'),
  text: z.string().min(1).max(100_000),
  voiceId: z.string().min(1).max(120).optional(),
}).strict()

export const workerAiRequestSchema = z.discriminatedUnion('capability', [
  modelRequestSchema,
  ttsRequestSchema,
])

const textResponseSchema = z.object({
  ok: z.literal(true),
  capability: z.enum(['text', 'vision']),
  text: z.string(),
}).strict()

const ttsResponseSchema = z.object({
  ok: z.literal(true),
  capability: z.literal('tts'),
  audioBase64: z.string().min(1),
  audioFormat: z.enum(['mp3', 'wav']),
  durationMs: z.number().int().positive(),
}).strict()

export const workerAiSuccessSchema = z.discriminatedUnion('capability', [
  textResponseSchema,
  ttsResponseSchema,
])

export const workerAiErrorSchema = z.object({
  ok: z.literal(false),
  code: z.enum([
    'UNAUTHORIZED',
    'INVALID_REQUEST',
    'ATTEMPT_NOT_ACTIVE',
    'OPERATION_REPLAYED',
    'AI_UNAVAILABLE',
  ]),
}).strict()

export type WorkerAiRequest = z.infer<typeof workerAiRequestSchema>
export type WorkerAiSuccess = z.infer<typeof workerAiSuccessSchema>
export type WorkerAiError = z.infer<typeof workerAiErrorSchema>
