import { z } from 'zod'
import { StableIssueCodeSchema } from './failure'
import { CvcTaskIdSchema } from './task-ids'

export const PIPELINE_PROGRESS_PHASES = [
  'queued',
  'started',
  'checkpoint',
  'completed',
  'failed',
  'cancelled',
] as const

export const SafeProgressEventV1Schema = z.object({
  schemaVersion: z.literal(1),
  taskId: CvcTaskIdSchema,
  pipelineRunId: z.uuid(),
  attemptId: z.uuid(),
  phase: z.enum(PIPELINE_PROGRESS_PHASES),
  progress: z.number().int().min(0).max(100),
  issueCode: StableIssueCodeSchema.optional(),
  userMessage: z.string().max(240).optional(),
}).strict()

export type PipelineProgressPhase =
  (typeof PIPELINE_PROGRESS_PHASES)[number]
export type SafeProgressEventV1 = z.infer<typeof SafeProgressEventV1Schema>
