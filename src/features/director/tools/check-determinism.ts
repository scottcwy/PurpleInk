import { z } from 'zod'
import { checkSource, type DeterminismViolation } from '@/lib/determinism'
import type { DirectorTool, DirectorToolResult } from '../pi-session'

const inputSchema = z.object({ source: z.string().min(1) }).strict()

export type DeterminismInspection =
  | { ok: true; violations: [] }
  | { ok: false; violations: DeterminismViolation[] }

/** 扫描分镜源码；违规作为数据返回，供 Agent 修订后重试。 */
export function inspectDeterminism(source: string): DeterminismInspection {
  const violations = checkSource(source)
  return violations.length === 0
    ? { ok: true, violations: [] }
    : { ok: false, violations }
}

export function createCheckDeterminismTool(): DirectorTool {
  return {
    name: 'check_determinism',
    label: '检查确定性',
    description: '扫描 FABRICATE HTML 中的非确定性渲染违规。',
    parameters: {
      type: 'object',
      properties: { source: { type: 'string', minLength: 1 } },
      required: ['source'],
      additionalProperties: false,
    },
    async execute(input): Promise<DirectorToolResult> {
      const parsed = inputSchema.safeParse(input)
      if (!parsed.success) {
        const details = {
          ok: false as const,
          violations: [],
          errors: parsed.error.issues.map((issue) => issue.message),
        }
        return {
          content: JSON.stringify(details),
          details,
          terminate: false,
        }
      }
      const details = inspectDeterminism(parsed.data.source)
      return {
        content: JSON.stringify(details),
        details,
        terminate: details.ok,
      }
    },
  }
}
