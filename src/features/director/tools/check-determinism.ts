import { z } from 'zod'
import type { DirectorTool, DirectorToolResult } from '../pi-session'
import type { FabricateRuntimeProbe } from './fabricate-runtime-probe'
import {
  inspectFabricateCandidate,
  type DeterminismInspection,
} from './fabricate-source-gate'

const inputSchema = z.object({ source: z.string().min(1) }).strict()

export type { DeterminismInspection } from './fabricate-source-gate'

interface CheckDeterminismDependencies {
  probeRuntime?: FabricateRuntimeProbe
}

export function createCheckDeterminismTool(
  dependencies: CheckDeterminismDependencies = {},
): DirectorTool {
  return {
    name: 'check_determinism',
    label: '检查确定性',
    description:
      '静态扫描并用真实浏览器检查 FABRICATE HTML 的确定性、运行时与固定 1920×1080 横屏画布合同。',
    parameters: {
      type: 'object',
      properties: { source: { type: 'string', minLength: 1 } },
      required: ['source'],
      additionalProperties: false,
    },
    async execute(input, signal): Promise<DirectorToolResult> {
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
      const details: DeterminismInspection = await inspectFabricateCandidate(
        parsed.data.source,
        {
          ...(dependencies.probeRuntime
            ? { probeRuntime: dependencies.probeRuntime }
            : {}),
          ...(signal ? { signal } : {}),
        },
      )
      return {
        content: JSON.stringify(details),
        details,
        terminate: details.ok,
      }
    },
  }
}
