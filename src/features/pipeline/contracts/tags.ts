import { z } from 'zod'

const CanonicalUuidSchema = z.uuid().transform((value) => value.toLowerCase())

const TaskTagScopeSchema = z.object({
  workspaceId: CanonicalUuidSchema,
  projectId: CanonicalUuidSchema,
  pipelineRunId: CanonicalUuidSchema,
  shotId: CanonicalUuidSchema.optional(),
}).strict()

export type TaskTagScope = z.input<typeof TaskTagScopeSchema>

export function buildTaskTags(input: TaskTagScope): string[] {
  const scope = TaskTagScopeSchema.parse(input)
  const tags = [
    `workspace:${scope.workspaceId}`,
    `project:${scope.projectId}`,
    `pipeline:${scope.pipelineRunId}`,
  ]
  if (scope.shotId) tags.push(`shot:${scope.shotId}`)
  return tags
}
