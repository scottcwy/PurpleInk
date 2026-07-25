import { z } from "zod"

export const StableIssueCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{1,63}$/)

export const StableFailureCodeSchema = StableIssueCodeSchema

export const FailureSummaryV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    code: StableFailureCodeSchema,
    userMessage: z.string().min(1).max(240),
    retryable: z.boolean(),
  })
  .strict()

export const TaskFailureV1Schema = FailureSummaryV1Schema

export type FailureSummaryV1 = z.infer<typeof FailureSummaryV1Schema>
export type TaskFailureV1 = FailureSummaryV1

export class TaskFailureError extends Error {
  readonly failure: TaskFailureV1

  constructor(input: unknown) {
    const failure = TaskFailureV1Schema.parse(input)
    super(failure.userMessage)
    this.name = "TaskFailureError"
    this.failure = failure
  }
}

export function handlePipelineTaskError(input: {
  error: unknown
}): { skipRetrying: true } | undefined {
  return input.error instanceof TaskFailureError &&
    !input.error.failure.retryable
    ? { skipRetrying: true }
    : undefined
}
