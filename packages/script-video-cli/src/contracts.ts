import { z } from 'zod'

export const SCRIPT_VIDEO_SCHEMA_VERSION = 1 as const

export const narrationModeSchema = z.enum(['off', 'auto', 'required'])
export type NarrationMode = z.infer<typeof narrationModeSchema>

export const scriptUnitSchema = z
  .object({
    id: z.string().regex(/^U\d{3}$/u, 'unit id 必须匹配 U###'),
    text: z.string().trim().min(1).max(20_000),
    visualIntent: z.string().trim().min(1).max(48).default('show'),
    startMs: z.number().int().nonnegative().optional(),
    endMs: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.startMs === undefined) !== (value.endMs === undefined)) {
      context.addIssue({ code: 'custom', message: 'startMs/endMs 必须同时存在' })
    }
    if (value.startMs !== undefined && value.endMs !== undefined && value.endMs <= value.startMs) {
      context.addIssue({ code: 'custom', message: 'endMs 必须晚于 startMs' })
    }
  })

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

const directorNarrativeSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value : isJsonContainer(value) ? JSON.stringify(value) : value),
  z.string().trim().min(1).max(30_000),
)

const shotCompositionSchema = z.preprocess(
  normalizeShotComposition,
  z.enum(['full-bleed', 'split', 'diagram', 'code', 'timeline']),
)

export const directorPlanSchema = z
  .object({
    masterPlan: directorNarrativeSchema,
    styleBible: directorNarrativeSchema,
  })
  .strict()
export type DirectorPlan = z.output<typeof directorPlanSchema>

export const shotPlanSchema = z
  .object({
    id: z.string().regex(/^S\d{3}$/u, 'shot id 必须匹配 S###'),
    sourceUnitId: z.string().regex(/^U\d{3}$/u, 'sourceUnitId 必须匹配 U###'),
    purpose: z.string().trim().min(1).max(500),
    visualIntent: z.string().trim().min(1).max(500),
    composition: shotCompositionSchema,
    visualDescription: z.string().trim().min(1).max(4_000),
    facts: z.array(z.string().trim().min(1).max(500)).max(12),
    onScreenText: z.array(z.string().trim().min(1).max(200)).max(12),
    durationSec: z.number().positive().max(120),
  })
  .strict()
export type ShotPlan = z.output<typeof shotPlanSchema>

function isJsonContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null
}

function normalizeShotComposition(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const normalized = value.trim().toLowerCase()
  if (['full-bleed', 'split', 'diagram', 'code', 'timeline'].includes(normalized)) return normalized
  if (/split|dual|compare|two-column|左右/u.test(normalized)) return 'split'
  if (/code|terminal|editor|console|代码|终端/u.test(normalized)) return 'code'
  if (/timeline|sequence|linear|pipeline|时间|流程/u.test(normalized)) return 'timeline'
  if (/full|hero|cinematic|全屏/u.test(normalized)) return 'full-bleed'
  return 'diagram'
}

export class InputContractError extends Error {
  readonly code = 'INPUT_INVALID' as const

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'InputContractError'
  }
}
