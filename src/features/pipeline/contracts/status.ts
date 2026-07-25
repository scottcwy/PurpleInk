import { z } from "zod"

export const NODE_EXECUTION_STATUSES = [
  "idle",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "stale",
] as const

export const PIPELINE_RUN_STATUSES = [
  "triggering",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const

export const TASK_ATTEMPT_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "superseded",
] as const

export const NodeExecutionStatusSchema = z.enum(NODE_EXECUTION_STATUSES)
export const PipelineRunStatusSchema = z.enum(PIPELINE_RUN_STATUSES)
export const TaskAttemptStatusSchema = z.enum(TASK_ATTEMPT_STATUSES)

export type NodeExecutionStatus = z.infer<typeof NodeExecutionStatusSchema>
export type PipelineRunStatus = z.infer<typeof PipelineRunStatusSchema>
export type TaskAttemptStatus = z.infer<typeof TaskAttemptStatusSchema>
