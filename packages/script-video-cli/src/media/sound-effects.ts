import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ShotPlan, SoundEffectsMode } from '../contracts'
import { runLoggedProcess } from './ffmpeg'

const assetRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/sfx')

export interface SoundEffectPreset {
  id: string
  file: string
  durationSec: number
  volume: number
  description: string
  source: string
}

export interface ResolvedSoundEffectCue {
  shotId: string
  preset: string
  at: number
  absoluteTimeSec: number
  durationSec: number
}

export interface SoundEffectMixResult {
  status: 'off' | 'no_cues' | 'mixed' | 'skipped'
  audioPath: string | null
  cueCount: number
  skippedPresetCount: number
  cuePlanPath?: string
  sfxPath?: string
  masterPath?: string
  errorCode?: 'SFX_RENDER_FAILED' | 'SFX_MIX_FAILED'
}

interface SoundEffectBuildOptions {
  mode: SoundEffectsMode
  plans: readonly ShotPlan[]
  narrationPath: string | null
  outputDir: string
  logPath?: string
  signal?: AbortSignal
}

interface Catalog {
  presets: SoundEffectPreset[]
}

const catalog = loadCatalog()
const presetById = new Map(catalog.presets.map((preset) => [preset.id, preset]))

export const SOUND_EFFECT_PRESETS: readonly SoundEffectPreset[] = catalog.presets

export function soundEffectPromptCatalog(): string {
  return SOUND_EFFECT_PRESETS.map((preset) => `${preset.id}：${preset.description}`).join('；')
}

export function hashSoundEffectCatalog(): string {
  return createHash('sha256')
    .update(readFileSync(join(assetRoot, 'catalog.json')))
    .digest('hex')
}

export function resolveSoundEffectCues(plans: readonly ShotPlan[]): {
  cues: ResolvedSoundEffectCue[]
  skippedPresetCount: number
  durationSec: number
} {
  const cues: ResolvedSoundEffectCue[] = []
  let skippedPresetCount = 0
  let shotStartSec = 0
  for (const plan of plans) {
    for (const cue of plan.soundEffects ?? []) {
      const preset = presetById.get(cue.preset.trim().toLowerCase())
      if (!preset) {
        skippedPresetCount += 1
        continue
      }
      cues.push({
        shotId: plan.id,
        preset: preset.id,
        at: cue.at,
        absoluteTimeSec: round(shotStartSec + plan.durationSec * cue.at),
        durationSec: preset.durationSec,
      })
    }
    shotStartSec += plan.durationSec
  }
  return { cues, skippedPresetCount, durationSec: round(shotStartSec) }
}

export async function buildSoundEffectMix(options: SoundEffectBuildOptions): Promise<SoundEffectMixResult> {
  if (options.mode === 'off') {
    return { status: 'off', audioPath: options.narrationPath, cueCount: 0, skippedPresetCount: 0 }
  }
  const resolvedCues = resolveSoundEffectCues(options.plans)
  const audioDir = join(options.outputDir, 'audio')
  await mkdir(audioDir, { recursive: true })
  const cuePlanPath = join(audioDir, 'sfx-cues.json')
  await writeFile(
    cuePlanPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        durationSec: resolvedCues.durationSec,
        cues: resolvedCues.cues,
        skippedPresetCount: resolvedCues.skippedPresetCount,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  if (resolvedCues.cues.length === 0) {
    return {
      status: 'no_cues',
      audioPath: options.narrationPath,
      cueCount: 0,
      skippedPresetCount: resolvedCues.skippedPresetCount,
      cuePlanPath,
    }
  }

  const sfxPath = join(audioDir, 'sfx.wav')
  const rendered = await renderSoundEffectTrack(resolvedCues.cues, resolvedCues.durationSec, sfxPath, options).catch(
    () => false,
  )
  if (!rendered) {
    return {
      status: 'skipped',
      audioPath: options.narrationPath,
      cueCount: resolvedCues.cues.length,
      skippedPresetCount: resolvedCues.skippedPresetCount,
      cuePlanPath,
      errorCode: 'SFX_RENDER_FAILED',
    }
  }

  const masterPath = join(audioDir, 'master.wav')
  const mixed = options.narrationPath
    ? await mixNarrationAndSoundEffects(
        options.narrationPath,
        sfxPath,
        masterPath,
        resolvedCues.durationSec,
        options,
      ).catch(() => false)
    : await copyFile(sfxPath, masterPath)
        .then(() => true)
        .catch(() => false)
  if (!mixed) {
    return {
      status: 'skipped',
      audioPath: options.narrationPath,
      cueCount: resolvedCues.cues.length,
      skippedPresetCount: resolvedCues.skippedPresetCount,
      cuePlanPath,
      sfxPath,
      errorCode: 'SFX_MIX_FAILED',
    }
  }
  return {
    status: 'mixed',
    audioPath: masterPath,
    cueCount: resolvedCues.cues.length,
    skippedPresetCount: resolvedCues.skippedPresetCount,
    cuePlanPath,
    sfxPath,
    masterPath,
  }
}

async function renderSoundEffectTrack(
  cues: readonly ResolvedSoundEffectCue[],
  durationSec: number,
  outputPath: string,
  options: Pick<SoundEffectBuildOptions, 'logPath' | 'signal'>,
): Promise<boolean> {
  const grouped = new Map<string, ResolvedSoundEffectCue[]>()
  for (const cue of cues) grouped.set(cue.preset, [...(grouped.get(cue.preset) ?? []), cue])
  const args = ['-y']
  const filters: string[] = []
  const cueLabels: string[] = []
  let inputIndex = 0
  let cueIndex = 0
  for (const [presetId, presetCues] of grouped) {
    const preset = presetById.get(presetId)
    if (!preset) continue
    args.push('-i', join(assetRoot, preset.file))
    const base = `p${inputIndex}`
    if (presetCues.length === 1) {
      const label = `c${cueIndex++}`
      const delayMs = Math.round(presetCues[0]!.absoluteTimeSec * 1000)
      filters.push(
        `[${inputIndex}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,volume=${preset.volume},adelay=${delayMs}|${delayMs}[${label}]`,
      )
      cueLabels.push(`[${label}]`)
    } else {
      const splitLabels = presetCues.map((_cue, index) => `${base}_${index}`)
      filters.push(
        `[${inputIndex}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,volume=${preset.volume},asplit=${presetCues.length}${splitLabels.map((label) => `[${label}]`).join('')}`,
      )
      presetCues.forEach((cue, index) => {
        const label = `c${cueIndex++}`
        const delayMs = Math.round(cue.absoluteTimeSec * 1000)
        filters.push(`[${splitLabels[index]}]adelay=${delayMs}|${delayMs}[${label}]`)
        cueLabels.push(`[${label}]`)
      })
    }
    inputIndex += 1
  }
  const silenceInputIndex = inputIndex
  args.push('-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${durationSec}`)
  const mixLabels = [...cueLabels, `[${silenceInputIndex}:a]`]
  filters.push(
    `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=longest:normalize=0,alimiter=limit=0.9,atrim=0:${durationSec}[out]`,
  )
  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[out]',
    '-ac',
    '2',
    '-ar',
    '48000',
    '-c:a',
    'pcm_s16le',
    outputPath,
  )
  const result = await runLoggedProcess('ffmpeg', args, { logPath: options.logPath, signal: options.signal })
  return result.code === 0
}

async function mixNarrationAndSoundEffects(
  narrationPath: string,
  sfxPath: string,
  outputPath: string,
  durationSec: number,
  options: Pick<SoundEffectBuildOptions, 'logPath' | 'signal'>,
): Promise<boolean> {
  const result = await runLoggedProcess(
    'ffmpeg',
    [
      '-y',
      '-i',
      narrationPath,
      '-i',
      sfxPath,
      '-filter_complex',
      `[0:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[voice];[1:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[sfx];[voice][sfx]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95,atrim=0:${durationSec}[out]`,
      '-map',
      '[out]',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-c:a',
      'pcm_s16le',
      outputPath,
    ],
    { logPath: options.logPath, signal: options.signal },
  )
  return result.code === 0
}

function loadCatalog(): Catalog {
  const source = readFileSync(join(assetRoot, 'catalog.json'), 'utf8')
  if (source.includes('\uFFFD')) throw new Error('SFX_CATALOG_ENCODING_INVALID')
  const parsed: unknown = JSON.parse(source)
  if (!isRecord(parsed) || !Array.isArray(parsed.presets)) throw new Error('SFX_CATALOG_INVALID')
  const presets = parsed.presets.map(parsePreset)
  if (presets.length !== 20 || new Set(presets.map((preset) => preset.id)).size !== presets.length) {
    throw new Error('SFX_CATALOG_INVALID')
  }
  return { presets }
}

function parsePreset(value: unknown): SoundEffectPreset {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.file !== 'string' ||
    typeof value.durationSec !== 'number' ||
    typeof value.volume !== 'number' ||
    typeof value.description !== 'string' ||
    typeof value.source !== 'string'
  ) {
    throw new Error('SFX_CATALOG_INVALID')
  }
  return {
    id: value.id,
    file: value.file,
    durationSec: value.durationSec,
    volume: value.volume,
    description: value.description,
    source: value.source,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
