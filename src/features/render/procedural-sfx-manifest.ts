import { z } from 'zod'
import { createHash } from 'node:crypto'
import {
  PROCEDURAL_SFX_GENERATOR_VERSION,
  buildBoundaryCuePlan,
  isProceduralSfxResultContract,
  type ProceduralSfxCue,
  type ProceduralSfxMode,
} from '@purpleink/procedural-sfx'
import type { MediaAssemblyPlan } from './media-assembly'
import type { ProceduralSfxMixResult } from './procedural-sfx-mix'
import type { StorageAdapter } from '@/lib/storage'

export const PROCEDURAL_SFX_MANIFEST_SCHEMA_VERSION =
  'cvc.procedural-sfx-manifest/v1' as const

export interface ProceduralSfxPlanFingerprintFacts {
  mode: ProceduralSfxMode
  generatorVersion: typeof PROCEDURAL_SFX_GENERATOR_VERSION
  cueCount: number
  timingHash: string | null
  cuePlanHash: string | null
}

export interface ResolvedProceduralSfxPlan {
  facts: ProceduralSfxPlanFingerprintFacts
  cues: ProceduralSfxCue[]
}

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u)
const manifestSchema = z
  .object({
    schemaVersion: z.literal(PROCEDURAL_SFX_MANIFEST_SCHEMA_VERSION),
    attemptId: z.string().min(1),
    finalContentHash: hashSchema,
    mode: z.enum(['off', 'procedural']),
    status: z.enum([
      'applied',
      'omitted-off',
      'omitted-no-cues',
      'omitted-unsupported',
      'omitted-error',
    ]),
    generatorVersion: z.literal(PROCEDURAL_SFX_GENERATOR_VERSION),
    cueCount: z.number().int().nonnegative(),
    timingHash: hashSchema.nullable(),
    cuePlanHash: hashSchema.nullable(),
    waveformHashes: z.array(hashSchema),
    failureCode: z.literal('PROCEDURAL_SFX_MIX_FAILED').optional(),
  })
  .strict()
  .refine(isProceduralSfxResultContract, {
    message: '程序化音效 Manifest 字段组合无效',
  })

export type ProceduralSfxManifest = z.infer<typeof manifestSchema>

export function resolveProceduralSfxPlan(
  plan: MediaAssemblyPlan
): ResolvedProceduralSfxPlan {
  const mode = plan.soundEffects ?? 'off'
  if (mode === 'off') {
    return {
      facts: {
        mode,
        generatorVersion: PROCEDURAL_SFX_GENERATOR_VERSION,
        cueCount: 0,
        timingHash: null,
        cuePlanHash: null,
      },
      cues: [],
    }
  }
  const cuePlan = buildBoundaryCuePlan({
    fps: plan.fps,
    totalFrames: plan.totalFrames,
    boundaries: shotBoundaries(plan),
  })
  return {
    facts: {
      mode,
      generatorVersion: cuePlan.generatorVersion,
      cueCount: cuePlan.cues.length,
      timingHash: cuePlan.timingHash,
      cuePlanHash: cuePlan.cuePlanHash,
    },
    cues: cuePlan.cues,
  }
}

export function proceduralSfxPlanFingerprintFacts(
  plan: MediaAssemblyPlan
): ProceduralSfxPlanFingerprintFacts {
  return resolveProceduralSfxPlan(plan).facts
}

export function buildProceduralSfxManifestBytes(input: {
  attemptId: string
  finalContentHash: string
  soundEffects: ProceduralSfxMixResult
}): Buffer {
  const manifest: ProceduralSfxManifest = {
    schemaVersion: PROCEDURAL_SFX_MANIFEST_SCHEMA_VERSION,
    attemptId: input.attemptId,
    finalContentHash: input.finalContentHash,
    ...input.soundEffects,
  }
  return Buffer.from(JSON.stringify(manifestSchema.parse(manifest)), 'utf-8')
}

export function parseProceduralSfxManifestForFinal(
  bytes: Buffer,
  expected: { attemptId: string; finalContentHash: string }
): ProceduralSfxManifest | null {
  try {
    const parsed = manifestSchema.parse(
      JSON.parse(bytes.toString('utf-8')) as unknown
    )
    return parsed.attemptId === expected.attemptId &&
      parsed.finalContentHash === expected.finalContentHash
      ? parsed
      : null
  } catch {
    return null
  }
}

export function proceduralSfxManifestStorageKey(input: {
  projectId: string
  attemptId: string
  finalContentHash: string
}): string {
  return (
    `exports/${input.projectId}/procedural-sfx/` +
    `${input.attemptId}-${input.finalContentHash}.json`
  )
}

export async function storeProceduralSfxManifest(
  storage: Pick<StorageAdapter, 'put'>,
  input: {
    projectId: string
    attemptId: string
    finalContentHash: string
    soundEffects: ProceduralSfxMixResult
  }
): Promise<{ storageKey: string; contentHash: string; sizeBytes: number }> {
  const bytes = buildProceduralSfxManifestBytes(input)
  const requestedKey = proceduralSfxManifestStorageKey(input)
  const storageKey = await storage.put(requestedKey, bytes)
  return {
    storageKey,
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
  }
}

export async function readBoundProceduralSfxManifest(
  storage: Pick<StorageAdapter, 'get'>,
  artifact: {
    schemaVersion: string
    storageKey: string
    contentHash: string
    sizeBytes: number
  },
  expected: { attemptId: string; finalContentHash: string }
): Promise<ProceduralSfxManifest | null> {
  if (artifact.schemaVersion !== PROCEDURAL_SFX_MANIFEST_SCHEMA_VERSION) {
    return null
  }
  try {
    const bytes = await storage.get(artifact.storageKey)
    if (
      bytes.byteLength !== artifact.sizeBytes ||
      createHash('sha256').update(bytes).digest('hex') !== artifact.contentHash
    ) {
      return null
    }
    return parseProceduralSfxManifestForFinal(bytes, expected)
  } catch {
    return null
  }
}

function shotBoundaries(plan: MediaAssemblyPlan): number[] {
  let frame = 0
  return plan.shots.map((shot) => {
    const boundary = frame
    frame += shot.durationInFrames
    return boundary
  })
}
