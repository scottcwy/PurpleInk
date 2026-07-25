import { z } from "zod"
import type { ExecutionContextV1 } from "../execution-context"
import type { CvcTaskId } from "../contracts/task-ids"
import { TaskFailureError } from "../contracts/failure"
import { Sha256HexSchema } from "../contracts/task-payload"
import {
  TASK_OUTCOMES,
  TaskResultV1Schema,
  type TaskResultV1,
} from "../contracts/task-result"

export const PortResultSchema = z.object({
  artifactIds: z.array(z.uuid()),
  checkpointHash: Sha256HexSchema,
  outcome: z.enum(TASK_OUTCOMES).optional(),
}).strict()

export type PortResult = z.infer<typeof PortResultSchema>

export type DomainTaskPort = (
  context: ExecutionContextV1,
) => Promise<PortResult>

export interface DomainTaskService {
  execute(context: ExecutionContextV1): Promise<TaskResultV1>
}

export function createPendingDomainPort(label: string): DomainTaskPort {
  return async () => {
    throw new TaskFailureError({
      schemaVersion: 1,
      code: "DOMAIN_ADAPTER_PENDING",
      userMessage: `${label} 领域适配器将在对应迁移阶段绑定`,
      retryable: false,
    })
  }
}

export function mapPortResult(
  taskId: CvcTaskId,
  context: ExecutionContextV1,
  result: PortResult,
): TaskResultV1 {
  const parsed = PortResultSchema.parse(result)
  return TaskResultV1Schema.parse({
    schemaVersion: 1,
    taskId,
    pipelineRunId: context.pipelineRunId,
    attemptId: context.attemptId,
    outcome: parsed.outcome ?? "completed",
    artifactIds: parsed.artifactIds,
    checkpointHash: parsed.checkpointHash,
  })
}

export function createTaskService(
  taskId: CvcTaskId,
  port: DomainTaskPort,
): DomainTaskService {
  return {
    async execute(context) {
      context.signal.throwIfAborted()
      await context.progress({ phase: "started", progress: 0 })
      try {
        const result = await port(context)
        context.signal.throwIfAborted()
        const mapped = mapPortResult(taskId, context, result)
        await context.progress({ phase: "completed", progress: 100 })
        return mapped
      } catch (error) {
        const failure =
          error instanceof TaskFailureError ? error.failure : undefined
        await context.progress({
          phase: context.signal.aborted ? "cancelled" : "failed",
          progress: 100,
          issueCode: failure?.code ?? "TASK_EXECUTION_FAILED",
          userMessage:
            failure?.userMessage ?? "任务执行失败，请检查配置后重试",
        })
        throw error
      }
    },
  }
}
