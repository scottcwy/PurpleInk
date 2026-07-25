import { z } from "zod"

import { CvcTaskIdSchema } from "./task-ids"
import { Sha256HexSchema } from "./task-payload"

export const TASK_OUTCOMES = ["completed", "checkpoint-reused"] as const

export const TaskResultV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: CvcTaskIdSchema,
    pipelineRunId: z.uuid(),
    attemptId: z.uuid(),
    outcome: z.enum(TASK_OUTCOMES),
    artifactIds: z.array(z.uuid()),
    checkpointHash: Sha256HexSchema,
  })
  .strict()

export type TaskResultV1 = z.infer<typeof TaskResultV1Schema>
