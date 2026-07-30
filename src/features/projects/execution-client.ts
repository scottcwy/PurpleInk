import { z } from 'zod'
import type { ProjectExecutionSnapshot } from './project-execution-contract'
import { throwIfUnauthenticated } from '@/features/auth/unauthenticated-error'

const phaseSchema = z.enum([
  'capture',
  'script',
  'narration',
  'compose',
  'render',
  'export',
])
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
const failureCodeSchema = z.enum([
  'WEBSITE_ENGINE_TIMEOUT',
  'WEBSITE_ENGINE_FAILED',
  'WEBSITE_ENGINE_UNAVAILABLE',
  'WEBSITE_ENGINE_RESPONSE_INVALID',
  'WEBSITE_VIDEO_INVALID',
  'WEBSITE_PROJECT_INVALID',
  'WEBSITE_EXECUTION_FAILED',
  'WEBSITE_VERIFICATION_FAILED',
  'WEBSITE_STATE_INCONSISTENT',
])
const verificationSchema = z.object({
  checkPassed: z.boolean(),
  goldenVerified: z.boolean(),
  goldenCheckCount: z.number().int().nonnegative(),
  outcome: z.enum(['passed', 'degraded']),
}).strict()
const artifactProjectionSchema = z.object({
  artifactId: z.string().min(1).max(128),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
  sizeBytes: z.number().int().nonnegative(),
}).strict()
const stageSchema = z.object({
  nodeId: z.string().min(1).max(128),
  phase: phaseSchema,
  state: z.enum([
    'idle',
    'queued',
    'running',
    'succeeded',
    'blocked',
    'failed',
    'cancelled',
  ]),
  updatedAt: z.iso.datetime(),
  enginePhase: enginePhaseSchema.optional(),
  durationSec: z.number().nonnegative().nullable().optional(),
  durationSource: z.enum(['request', 'output']).nullable().optional(),
  elapsedSec: z.number().nonnegative().nullable().optional(),
  verification: verificationSchema.optional(),
  artifact: artifactProjectionSchema.optional(),
  failureCode: failureCodeSchema.optional(),
}).strict()
const snapshotSchema = z.object({
  workflowKind: z.enum(['script', 'audio', 'website']),
  state: z.enum([
    'idle',
    'queued',
    'running',
    'stopping',
    'recovering',
    'succeeded',
    'blocked',
    'failed',
    'cancelled',
  ]),
  active: z.boolean(),
  canStart: z.boolean(),
  canStop: z.boolean(),
  attempt: z.object({
    id: z.string().min(1).max(128),
    status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
    updatedAt: z.iso.datetime(),
    failureCode: failureCodeSchema.optional(),
  }).strict().nullable(),
  currentStage: z.object({
    nodeId: z.string().min(1).max(128),
    phase: phaseSchema,
    enginePhase: enginePhaseSchema.optional(),
    updatedAt: z.iso.datetime(),
  }).strict().nullable(),
  stages: z.array(stageSchema).max(6),
  delivery: z.object({
    artifactId: z.string().min(1).max(128),
    attemptId: z.string().min(1).max(128),
    lifecycle: z.enum(['draft', 'approved', 'released', 'rejected']),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
    sizeBytes: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    verification: verificationSchema.optional(),
    downloadUrl: z.string().startsWith('/api/artifacts/').optional(),
  }).strict().nullable(),
  revision: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict()

export function parseProjectExecutionSnapshot(
  value: unknown,
): ProjectExecutionSnapshot {
  const parsed = snapshotSchema.safeParse(value)
  if (!parsed.success) throw new Error('项目执行状态响应无效')
  return parsed.data as ProjectExecutionSnapshot
}

export async function getProjectExecution(
  projectId: string,
  fetcher: typeof fetch = fetch,
): Promise<ProjectExecutionSnapshot> {
  const response = await fetcher(
    `/api/projects/${encodeURIComponent(projectId)}/execution`,
    { cache: 'no-store' },
  )
  throwIfUnauthenticated(response)
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('项目执行状态响应无效')
  }
  const result = body as Record<string, unknown>
  if (!response.ok || result.ok !== true) {
    throw new Error('暂时无法读取项目执行状态')
  }
  return parseProjectExecutionSnapshot(result.execution)
}
