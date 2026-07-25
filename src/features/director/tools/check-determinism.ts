import { z } from 'zod'
import {
  inspectFabricateSource,
  type FabricateSourceInspection,
} from '@/features/canvas/contracts'
import type { DirectorTool, DirectorToolResult } from '../pi-session'

const inputSchema = z.object({ source: z.string().min(1) }).strict()

export type DeterminismInspection = FabricateSourceInspection

export function createCheckDeterminismTool(): DirectorTool {
  return {
    name: 'check_determinism',
    label: '检查确定性',
    description: '扫描 FABRICATE HTML 的确定性与固定 1920×1080 横屏画布合同。',
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
      const details = inspectFabricateSource(parsed.data.source)
      return {
        content: JSON.stringify(details),
        details,
        terminate: details.ok,
      }
    },
  }
}
