import { z } from 'zod'

export const SCRIPT_VIDEO_SCHEMA_VERSION = 1 as const

export const narrationModeSchema = z.enum(['off', 'auto', 'required'])
export type NarrationMode = z.infer<typeof narrationModeSchema>

export const scriptUnitSchema = z
  .object({
    id: z.string().regex(/^U\d{3}$/u, 'unit id 必须匹配 U###'),
    text: z.string().trim().min(1).max(20_000),
    visualIntent: z.string().trim().min(1).max(48).default('show'),
  })
  .strict()

export const scriptVideoInputSchema = z
  .object({
    schemaVersion: z.literal(SCRIPT_VIDEO_SCHEMA_VERSION),
    title: z.string().trim().min(1).max(200),
    language: z.string().trim().min(2).max(24).default('zh-CN'),
    durationSec: z.number().int().min(5).max(600),
    visualStyle: z.string().trim().min(1).max(500).default('editorial technical'),
    narration: narrationModeSchema.default('auto'),
    units: z.array(scriptUnitSchema).min(1).max(128),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>()
    for (const [index, unit] of value.units.entries()) {
      if (seen.has(unit.id)) {
        context.addIssue({
          code: 'custom',
          path: ['units', index, 'id'],
          message: `unit id 重复: ${unit.id}`,
        })
      }
      seen.add(unit.id)
    }
  })

export type ScriptVideoInput = z.output<typeof scriptVideoInputSchema>
export type ScriptUnit = ScriptVideoInput['units'][number]

export class InputContractError extends Error {
  readonly code = 'INPUT_INVALID' as const

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'InputContractError'
  }
}
