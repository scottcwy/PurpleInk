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
const soundEffectsProjectionSchema = z.object({
  artifactId: z.string().min(1).max(128),
  lifecycle: z.enum(['draft', 'approved', 'released', 'rejected']),
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
  timingHash: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  cuePlanHash: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  waveformHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/u)),
  failureCode: z.literal('PROCEDURAL_SFX_MIX_FAILED').optional(),
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
const workItemStateSchema = z.enum([
  'idle',
  'queued',
  'running',
  'succeeded',
  'skipped',
  'blocked',
  'failed',
  'cancelled',
  'stale',
])
const workItemSchema = z.object({
  nodeId: z.string().min(1).max(128),
  logicalKey: z.string().min(1).max(256),
  state: workItemStateSchema,
  updatedAt: z.iso.datetime(),
}).strict()
const fanOutSchema = z.object({
  shotCount: z.number().int().nonnegative(),
  completedShotCount: z.number().int().nonnegative(),
  shots: z.array(z.object({
    shotId: z.string().min(1).max(128),
    state: workItemStateSchema,
    steps: z.array(workItemSchema).max(5),
  }).strict()).max(1_000),
}).strict()
const directorDetailShape = {
  director: z.array(workItemSchema).max(4),
  fanOut: fanOutSchema,
  merge: workItemSchema.nullable(),
  export: workItemSchema.nullable(),
}
const detailSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('script'), ...directorDetailShape }).strict(),
  z.object({
    kind: z.literal('audio'),
    asr: workItemSchema.nullable(),
    sourceAudioBound: z.boolean(),
    ...directorDetailShape,
  }).strict(),
  z.object({
    kind: z.literal('website'),
    stages: z.array(stageSchema).max(6),
  }).strict(),
])
const snapshotSchema = z.object({
  schemaVersion: z.literal(2),
  projectKind: z.enum(['script', 'audio', 'website']),
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
  currentWork: workItemSchema.nullable(),
  failure: z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
    origin: z.enum(['user', 'platform', 'provider', 'content', 'unknown']).optional(),
    retryable: z.boolean().optional(),
    recovery: z.enum([
      'auto_wait',
      'manual_retry',
      'fix_settings',
      'upgrade_plan',
      'edit_input',
      'switch_provider',
      'confirm_degraded_export',
      'contact_support',
    ]).optional(),
    referenceId: z.string().min(1).max(128).optional(),
  }).strict().nullable(),
  recovery: z.object({
    canStart: z.boolean(),
    canStop: z.boolean(),
    mode: z.enum(['none', 'start', 'stop', 'automatic', 'manual']),
  }).strict(),
  detail: detailSchema,
  stages: z.array(stageSchema).max(6),
  delivery: z.object({
    artifactId: z.string().min(1).max(128),
    attemptId: z.string().min(1).max(128),
    lifecycle: z.enum(['draft', 'approved', 'released', 'rejected']),
    schemaVersion: z.string().min(1).max(128),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
    sizeBytes: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    soundEffects: soundEffectsProjectionSchema.optional(),
    verification: verificationSchema.optional(),
    downloadUrl: z.string().startsWith('/api/artifacts/').optional(),
  }).strict().nullable(),
  revision: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict().superRefine((snapshot, context) => {
  if (
    snapshot.projectKind !== snapshot.workflowKind
    || snapshot.detail.kind !== snapshot.projectKind
  ) {
    context.addIssue({
      code: 'custom',
      message: '项目执行类型投影不一致',
      path: ['detail', 'kind'],
    })
  }
})

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
