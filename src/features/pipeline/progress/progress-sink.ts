import {
  SafeProgressEventV1Schema,
  type SafeProgressEventV1,
} from "../contracts/progress"

export const ProgressScopeV1Schema = SafeProgressEventV1Schema.pick({
  taskId: true,
  pipelineRunId: true,
  attemptId: true,
}).strict()

export const ProgressUpdateV1Schema = SafeProgressEventV1Schema.pick({
  phase: true,
  progress: true,
  issueCode: true,
  userMessage: true,
}).strict()

export type ProgressScopeV1 = {
  taskId: SafeProgressEventV1["taskId"]
  pipelineRunId: SafeProgressEventV1["pipelineRunId"]
  attemptId: SafeProgressEventV1["attemptId"]
}

export type ProgressUpdateV1 = {
  phase: SafeProgressEventV1["phase"]
  progress: SafeProgressEventV1["progress"]
  issueCode?: SafeProgressEventV1["issueCode"]
  userMessage?: SafeProgressEventV1["userMessage"]
}

export type ProgressSink = (update: ProgressUpdateV1) => Promise<void>

export type SafeProgressEventWriter = (
  event: SafeProgressEventV1,
) => Promise<void>

export function createScopedProgressSink(
  scope: ProgressScopeV1,
  writer: SafeProgressEventWriter,
): ProgressSink {
  const parsedScope = ProgressScopeV1Schema.parse(scope)

  return async (value: ProgressUpdateV1): Promise<void> => {
    const update = ProgressUpdateV1Schema.parse(value)
    const event = SafeProgressEventV1Schema.parse({
      schemaVersion: 1,
      ...parsedScope,
      ...update,
    })

    await writer(event)
  }
}
