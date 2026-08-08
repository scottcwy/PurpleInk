import { z } from 'zod'

export const runStatusSchema = z.enum([
  'created',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'degraded',
])
export type RunStatus = z.infer<typeof runStatusSchema>

export const stageStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'degraded',
])
export type StageStatus = z.infer<typeof stageStatusSchema>

export const runRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    runDir: z.string().min(1),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    title: z.string().min(1),
    workflowVersion: z.string().min(1),
    status: runStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
export type RunRecord = z.infer<typeof runRecordSchema>

export interface RunInputRecord {
  runId?: string
  inputHash: string
  title: string
  workflowVersion: string
}

export const stageRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    key: z.string().min(1),
    status: stageStatusSchema,
    attempt: z.number().int().positive(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    payload: z.unknown(),
    updatedAt: z.string().datetime(),
  })
  .strict()
export type StageRecord = z.infer<typeof stageRecordSchema>

export const runEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.string().min(1).max(128),
    timestamp: z.string().datetime(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
export type RunEventInput = {
  type: string
  data?: Record<string, unknown>
}
export type RunEvent = z.infer<typeof runEventSchema>

export const artifactRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    kind: z.string().min(1),
    relativePath: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    createdAt: z.string().datetime(),
  })
  .strict()
export type ArtifactRecord = z.infer<typeof artifactRecordSchema>

export interface StateStore {
  createRun(input: RunInputRecord): Promise<RunRecord>
  readRun(runDir: string): Promise<RunRecord>
  updateRun(runDir: string, patch: { status?: RunStatus }): Promise<RunRecord>
  writeStage(runDir: string, stage: Omit<StageRecord, 'schemaVersion' | 'updatedAt'>): Promise<void>
  readStage(runDir: string, key: string): Promise<StageRecord | null>
  appendEvent(runDir: string, event: RunEventInput): Promise<void>
  writeArtifact(runDir: string, artifact: Omit<ArtifactRecord, 'schemaVersion' | 'createdAt'>): Promise<void>
  assertResumeCompatible(runDir: string, input: Pick<RunInputRecord, 'inputHash' | 'workflowVersion'>): Promise<void>
}
