import type { ExportSettings } from '@/features/canvas/export-settings'
import {
  isProceduralSfxResultContract,
  type ProceduralSfxResultContract,
} from '@purpleink/procedural-sfx'

export type ExportArtifactSoundEffects = ProceduralSfxResultContract

export function isSoundEffectsMode(
  value: unknown
): value is ExportSettings['soundEffects'] {
  return value === 'off' || value === 'procedural'
}

export function parseExportArtifactSoundEffects(
  value: unknown
): ExportArtifactSoundEffects | null {
  if (!isProceduralSfxResultContract(value)) return null
  const raw = value
  return {
    mode: raw.mode,
    status: raw.status,
    generatorVersion: raw.generatorVersion,
    cueCount: raw.cueCount,
    timingHash: raw.timingHash,
    cuePlanHash: raw.cuePlanHash,
    waveformHashes: raw.waveformHashes,
    ...(raw.failureCode ? { failureCode: raw.failureCode } : {}),
  }
}
