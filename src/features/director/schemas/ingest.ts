import { z } from 'zod'

const nonEmptyText = z.string().min(1)
const unitIdSchema = z.string().regex(/^U\d{3}$/)
const shotIdSchema = z.string().regex(/^S\d{3}$/)
const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const publicPathSchema = z
  .string()
  .min(1)
  .regex(/^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\).+$/)

const uniqueUnitIdsSchema = z
  .array(unitIdSchema)
  .refine((items) => new Set(items).size === items.length, 'unitId 必须唯一')

export const scriptUnitSchema = z
  .object({
    unitId: unitIdSchema,
    text: nonEmptyText,
    order: z.number().int().nonnegative().optional(),
    speaker: nonEmptyText.optional(),
  })
  .strict()

export const scriptUnitsSchema = z.array(scriptUnitSchema).min(1)

/**
 * Demo INGEST 的模型输出边界。
 *
 * 音频 manifest/allocation 由音频领域根据实测媒体生成，不能由语言模型猜测。
 */
export const ingestStageResultSchema = z
  .object({
    scriptUnits: scriptUnitsSchema,
  })
  .strict()

const alignmentSchema = z
  .object({
    mode: z.enum([
      'tts-native',
      'unit-file',
      'monotonic-script-anchors',
      'duration-weight-fallback',
    ]),
    coverage: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1).optional(),
    sourceStartSample: z.number().int().nonnegative().optional(),
    sourceEndSample: z.number().int().min(1).optional(),
    reportUri: z.string().regex(/^project:\/\//).optional(),
  })
  .strict()

const anchorSchema = z
  .object({
    startChar: z.number().int().nonnegative(),
    endChar: z.number().int().min(1),
    startSample: z.number().int().nonnegative(),
    endSample: z.number().int().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict()

const audioUnitSchema = z
  .object({
    unitId: unitIdSchema,
    text: nonEmptyText,
    audioFile: publicPathSchema,
    durationMs: z.number().positive(),
    srtFile: nonEmptyText.optional(),
    source: z.enum(['tts', 'user']),
    sampleRateHz: z.number().int().min(8000).optional(),
    sampleCount: z.number().int().min(1).optional(),
    sha256: sha256Schema.optional(),
    alignment: alignmentSchema.optional(),
    anchors: z.array(anchorSchema).optional(),
  })
  .strict()

const alignmentReportSchema = z
  .object({
    policy: z.enum(['tts-native', 'unit-files', 'monotonic-script-anchors']),
    scriptCoverage: z.number().min(0).max(1),
    continuousCoverage: z.boolean(),
    lowConfidenceUnitIds: uniqueUnitIdsSchema,
  })
  .strict()

export const audioManifestSchema = z
  .object({
    version: z.number().int().min(1),
    contractVersion: z.enum(['legacy-v2', 'vnext-audio-v1']).optional(),
    digestPolicyVersion: nonEmptyText.optional(),
    engine: nonEmptyText,
    voice: nonEmptyText.optional(),
    sourceAudioFile: publicPathSchema.optional(),
    sourceAudioSha256: sha256Schema.optional(),
    units: z.array(audioUnitSchema).min(1),
    totalMs: z.number().positive(),
    alignmentReport: alignmentReportSchema.optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.contractVersion !== 'vnext-audio-v1') return
    requireVnextField(manifest.digestPolicyVersion, 'digestPolicyVersion', context)
    requireVnextField(manifest.alignmentReport, 'alignmentReport', context)
    manifest.units.forEach((unit, index) => {
      requireVnextField(unit.sampleRateHz, `units.${index}.sampleRateHz`, context)
      requireVnextField(unit.sampleCount, `units.${index}.sampleCount`, context)
      requireVnextField(unit.sha256, `units.${index}.sha256`, context)
      requireVnextField(unit.alignment, `units.${index}.alignment`, context)
    })
  })

const scriptRangeSchema = z
  .object({
    startChar: z.number().int().nonnegative(),
    endChar: z.number().int().min(1),
  })
  .strict()

const inputDigestsSchema = z
  .object({
    audioManifest: sha256Schema,
    runtimeBindings: sha256Schema,
    scriptUnits: sha256Schema,
  })
  .strict()

export const shotAllocationSchema = z
  .object({
    id: shotIdSchema,
    audioUnitId: unitIdSchema,
    scriptRange: scriptRangeSchema,
    substring: nonEmptyText,
    startInUnitMs: z.number().nonnegative(),
    endInUnitMs: z.number().positive(),
    startSample: z.number().int().nonnegative(),
    endSample: z.number().int().min(1),
    durationInFrames: z.number().int().min(1),
    allocationMethod: z.enum([
      'word-anchor',
      'character-anchor',
      'unit-boundary',
      'duration-weight-fallback',
    ]),
  })
  .strict()

export const audioAllocationSchema = z
  .object({
    schemaVersion: z.literal(1),
    inputDigests: inputDigestsSchema,
    fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
    shots: z.array(shotAllocationSchema).min(1),
    totalFrames: z.number().int().min(1),
  })
  .strict()

function requireVnextField(
  value: unknown,
  path: string,
  context: z.RefinementCtx
): void {
  if (value !== undefined) return
  context.addIssue({
    code: 'custom',
    path: path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
    message: 'vnext-audio-v1 必填字段',
  })
}

export type ScriptUnit = z.infer<typeof scriptUnitSchema>
export type ScriptUnits = z.infer<typeof scriptUnitsSchema>
export type ShotAllocation = z.infer<typeof shotAllocationSchema>
export type IngestStageResult = z.infer<typeof ingestStageResultSchema>
export type AudioManifest = z.infer<typeof audioManifestSchema>
export type AudioAllocation = z.infer<typeof audioAllocationSchema>
