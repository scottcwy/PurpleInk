import { z } from "zod"

export const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/)

const BaseTaskPayloadV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    pipelineRunId: z.uuid(),
    attemptId: z.uuid(),
    fingerprint: Sha256HexSchema,
    workflowVersion: z.string().min(1),
  })
  .strict()

const ProjectEntityV1Schema = z
  .object({
    type: z.literal("project"),
    id: z.uuid(),
  })
  .strict()

const ShotEntityV1Schema = z
  .object({
    type: z.literal("shot"),
    id: z.uuid(),
  })
  .strict()

export const ProjectTaskPayloadV1Schema = BaseTaskPayloadV1Schema.extend({
  entity: ProjectEntityV1Schema,
})
  .strict()
  .superRefine((payload, context) => {
    if (payload.entity.id !== payload.projectId) {
      context.addIssue({
        code: "custom",
        message: "project entity id must match projectId",
        path: ["entity", "id"],
      })
    }
  })

export const ShotTaskPayloadV1Schema = BaseTaskPayloadV1Schema.extend({
  entity: ShotEntityV1Schema,
  shotId: z.uuid(),
})
  .strict()
  .superRefine((payload, context) => {
    if (payload.entity.id !== payload.shotId) {
      context.addIssue({
        code: "custom",
        message: "shot entity id must match shotId",
        path: ["shotId"],
      })
    }
  })

export const TaskPayloadV1Schema = z.union([
  ProjectTaskPayloadV1Schema,
  ShotTaskPayloadV1Schema,
])

export type ProjectTaskPayloadV1 = z.infer<
  typeof ProjectTaskPayloadV1Schema
>
export type ShotTaskPayloadV1 = z.infer<typeof ShotTaskPayloadV1Schema>
export type TaskPayloadV1 = z.infer<typeof TaskPayloadV1Schema>
