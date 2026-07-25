import { z } from 'zod'
import type { DirectorTool, DirectorToolResult } from '../pi-session'
import {
  directorShotPlanSchema,
  type DirectorShotPlan,
} from '../schemas/director-shot-plan'

const inputSchema = z.object({ shotPlan: z.unknown() }).strict()

export type ShotPlanValidation =
  | { ok: true; value: DirectorShotPlan }
  | { ok: false; errors: string[] }

/** 使用项目原生 schema 校验分镜合同，不读取运行时 JSON Schema 文件。 */
export function validateShotPlanValue(value: unknown): ShotPlanValidation {
  const parsed = directorShotPlanSchema.safeParse(value)
  if (parsed.success) return { ok: true, value: parsed.data }
  return {
    ok: false,
    errors: parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`
    ),
  }
}

export function createValidateShotPlanTool(): DirectorTool {
  return {
    name: 'validate_shot_plan',
    label: '校验分镜合同',
    description: '用 CodeVideoCanvas 运行时 directorShotPlanSchema 校验 canonical shot plan。',
    parameters: {
      type: 'object',
      properties: { shotPlan: { type: 'object' } },
      required: ['shotPlan'],
      additionalProperties: false,
    },
    async execute(input): Promise<DirectorToolResult> {
      const envelope = inputSchema.safeParse(input)
      if (!envelope.success) {
        return failure(envelope.error.issues.map((issue) => issue.message))
      }
      const validation = validateShotPlanValue(envelope.data.shotPlan)
      if (!validation.ok) return failure(validation.errors)
      return {
        content: JSON.stringify({ ok: true, shotCount: validation.value.shots.length }),
        details: { ok: true, shotCount: validation.value.shots.length },
        terminate: true,
      }
    },
  }
}

function failure(errors: string[]): DirectorToolResult {
  return {
    content: JSON.stringify({ ok: false, errors }),
    details: { ok: false, errors },
    terminate: false,
  }
}
