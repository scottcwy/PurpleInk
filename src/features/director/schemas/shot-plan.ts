import { z } from 'zod'

const nonEmptyText = z.string().min(1)
const shotIdSchema = z.string().regex(/^S\d{3}$/)
const unitIdSchema = z.string().regex(/^U\d{3}$/)
const uniqueTextListSchema = z
  .array(nonEmptyText)
  .refine((items) => new Set(items).size === items.length, '列表项必须唯一')

const pointSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict()

const audioBindingSchema = z
  .object({
    unitId: unitIdSchema,
    startChar: z.number().int().nonnegative().optional(),
    endChar: z.number().int().min(1).optional(),
    durationWeight: z.number().positive().optional(),
  })
  .strict()
  .superRefine((binding, context) => {
    if ((binding.startChar === undefined) !== (binding.endChar === undefined)) {
      context.addIssue({
        code: 'custom',
        path: binding.startChar === undefined ? ['startChar'] : ['endChar'],
        message: 'startChar 与 endChar 必须同时提供',
      })
    }
  })

const purposeSchema = z
  .object({
    role: z.enum([
      'hook',
      'orient',
      'explain',
      'evidence',
      'contrast',
      'turn',
      'climax',
      'resolve',
      'cta',
      'pace',
    ]),
    statement: nonEmptyText,
  })
  .strict()

const visualGainSchema = z
  .object({
    type: z.enum([
      'definition',
      'cause',
      'contrast',
      'process',
      'evidence',
      'scale',
      'hierarchy',
      'uncertainty',
      'affect',
      'orient',
      'pace',
      'recall',
    ]),
    statement: nonEmptyText,
    sourceRefs: uniqueTextListSchema,
  })
  .strict()

export const compositionModeSchema = z.enum([
  'full-canvas',
  'split-world',
  'horizontal-flow',
  'vertical-journey',
  'pan-canvas',
  'zoom-stage',
  'depth-scene',
  'media-stage',
  'kinetic-type',
  'dashboard',
  'spatial-diagram',
])

const compositionSchema = z
  .object({
    mode: compositionModeSchema,
    spatialJourney: nonEmptyText,
    topologyRepeatException: nonEmptyText.optional(),
  })
  .strict()

const heroSchema = z
  .object({
    name: nonEmptyText,
    anatomy: uniqueTextListSchema,
    material: uniqueTextListSchema,
    scaleIntent: nonEmptyText,
  })
  .strict()

const motionSchema = z
  .object({
    dominantAction: nonEmptyText,
    phases: z.array(nonEmptyText).min(2).max(6),
  })
  .strict()

const keyframesSchema = z
  .object({
    frame0: nonEmptyText,
    p25: nonEmptyText,
    p60: nonEmptyText,
    p95: nonEmptyText,
    end: nonEmptyText,
  })
  .strict()

const sfxCueSchema = z
  .object({
    name: nonEmptyText,
    atMs: z.number().nonnegative(),
    volume: z.number().min(0).max(1).optional(),
  })
  .strict()

const handoffSchema = z
  .object({
    toShotId: shotIdSchema,
    objectId: nonEmptyText,
    endState: nonEmptyText,
    anchor: pointSchema.optional(),
  })
  .strict()

export const shotSchema = z
  .object({
    id: shotIdSchema,
    blockId: z.string().regex(/^B\d{2,3}$/),
    sourceUnitIds: z
      .array(unitIdSchema)
      .min(1)
      .refine((items) => new Set(items).size === items.length, 'sourceUnitIds 必须唯一'),
    audioBinding: audioBindingSchema,
    purpose: purposeSchema,
    visualGain: visualGainSchema,
    composition: compositionSchema,
    hero: heroSchema,
    onScreenText: uniqueTextListSchema.min(1),
    motion: motionSchema,
    keyframes: keyframesSchema,
    capabilities: uniqueTextListSchema,
    assetRefs: uniqueTextListSchema,
    sfxCues: z.array(sfxCueSchema),
    mustShow: uniqueTextListSchema,
    mustAvoid: uniqueTextListSchema,
    handoff: handoffSchema.optional(),
  })
  .strict()

export const shotPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: nonEmptyText,
    shots: z.array(shotSchema).min(1),
  })
  .strict()

export type Shot = z.infer<typeof shotSchema>
export type ShotPlan = z.infer<typeof shotPlanSchema>
export type CompositionMode = z.infer<typeof compositionModeSchema>
