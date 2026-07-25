import {
  TaskPayloadV1Schema,
  type TaskPayloadV1,
} from "./contracts/task-payload"
import type { CvcTaskId } from "./contracts/task-ids"
import {
  createScopedProgressSink,
  type ProgressSink,
  type SafeProgressEventWriter,
} from "./progress/progress-sink"

export type ExecutionContextV1 = {
  schemaVersion: 1
  workspaceId: string
  projectId: string
  pipelineRunId: string
  triggerRunId: string
  attemptId: string
  entity: TaskPayloadV1["entity"]
  shotId?: string
  fingerprint: string
  workflowVersion: string
  signal: AbortSignal
  progress: ProgressSink
}

export type CreateExecutionContextV1Input = {
  payload: TaskPayloadV1
  triggerRunId: string
  signal: AbortSignal
  progress: ProgressSink
}

export type CreateTaskExecutionContextV1Input = Omit<
  CreateExecutionContextV1Input,
  "progress"
> & {
  taskId: CvcTaskId
  writeProgress: SafeProgressEventWriter
}

export function createExecutionContext(
  input: CreateExecutionContextV1Input,
): ExecutionContextV1 {
  const payload = TaskPayloadV1Schema.parse(input.payload)
  const triggerRunId = input.triggerRunId.trim()
  if (!triggerRunId) {
    throw new Error("triggerRunId is required")
  }

  return {
    schemaVersion: 1,
    workspaceId: payload.workspaceId,
    projectId: payload.projectId,
    pipelineRunId: payload.pipelineRunId,
    triggerRunId,
    attemptId: payload.attemptId,
    entity: payload.entity,
    shotId: "shotId" in payload ? payload.shotId : undefined,
    fingerprint: payload.fingerprint,
    workflowVersion: payload.workflowVersion,
    signal: input.signal,
    progress: input.progress,
  }
}

export function createTaskExecutionContext(
  input: CreateTaskExecutionContextV1Input,
): ExecutionContextV1 {
  return createExecutionContext({
    payload: input.payload,
    triggerRunId: input.triggerRunId,
    signal: input.signal,
    progress: createScopedProgressSink(
      {
        taskId: input.taskId,
        pipelineRunId: input.payload.pipelineRunId,
        attemptId: input.payload.attemptId,
      },
      input.writeProgress,
    ),
  })
}
