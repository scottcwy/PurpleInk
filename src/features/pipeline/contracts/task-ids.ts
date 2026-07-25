import { z } from "zod"

export const CVC_TASK_IDS = [
  "cvc.pipeline.run",
  "cvc.project.plan",
  "cvc.shot.generate",
  "cvc.shot.media",
  "cvc.shot.render",
  "cvc.shot.qa",
  "cvc.project.compose",
] as const

export const CvcTaskIdSchema = z.enum(CVC_TASK_IDS)

export type CvcTaskId = z.infer<typeof CvcTaskIdSchema>
