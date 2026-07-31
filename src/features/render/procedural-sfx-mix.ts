import { createHash } from 'node:crypto'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import {
  PROCEDURAL_SFX_GENERATOR_VERSION,
  synthesizeProceduralWav,
  type ProceduralSfxMode,
  type ProceduralSfxStatus,
} from '@purpleink/procedural-sfx'
import {
  buildMediaAssemblyArgs,
  type MediaAssemblyArgsInput,
  type SoundEffectInput,
} from './media-ffmpeg-args'
import type { MediaAssemblyPlan } from './media-assembly'
import { resolveProceduralSfxPlan } from './procedural-sfx-manifest'

export interface ProceduralSfxMixResult {
  mode: ProceduralSfxMode
  status: ProceduralSfxStatus
  generatorVersion: typeof PROCEDURAL_SFX_GENERATOR_VERSION
  cueCount: number
  timingHash: string | null
  cuePlanHash: string | null
  waveformHashes: string[]
  failureCode?: 'PROCEDURAL_SFX_MIX_FAILED'
}

export interface PreparedProceduralSfx {
  inputs: SoundEffectInput[]
  result: ProceduralSfxMixResult
}

type BaseAssemblyInput = Omit<MediaAssemblyArgsInput, 'soundEffectInputs'>

export class ProceduralSfxMixError extends Error {
  override readonly name = 'ProceduralSfxMixError'
}

export async function prepareProceduralSfx(
  plan: MediaAssemblyPlan,
  workDirectory: string
): Promise<PreparedProceduralSfx> {
  const mode = plan.soundEffects ?? 'off'
  if (mode === 'off') return omitted('off', 'omitted-off')
  try {
    return await materializeProceduralSfx(plan, workDirectory)
  } catch (error) {
    if (!(error instanceof ProceduralSfxMixError)) throw error
    return omittedError()
  }
}

async function materializeProceduralSfx(
  plan: MediaAssemblyPlan,
  workDirectory: string
): Promise<PreparedProceduralSfx> {
  try {
    return await materializeProceduralSfxUnchecked(plan, workDirectory)
  } catch (cause) {
    if (cause instanceof ProceduralSfxMixError) throw cause
    throw new ProceduralSfxMixError('程序化音效生成失败', { cause })
  }
}

async function materializeProceduralSfxUnchecked(
  plan: MediaAssemblyPlan,
  workDirectory: string
): Promise<PreparedProceduralSfx> {
  const resolvedPlan = resolveProceduralSfxPlan(plan)
  if (resolvedPlan.cues.length === 0) {
    return {
      inputs: [],
      result: {
        ...baseResult('procedural'),
        status: 'omitted-no-cues',
        timingHash: resolvedPlan.facts.timingHash,
        cuePlanHash: resolvedPlan.facts.cuePlanHash,
      },
    }
  }

  const inputs: SoundEffectInput[] = []
  const waveformHashes: string[] = []
  for (const [index, cue] of resolvedPlan.cues.entries()) {
    const bytes = synthesizeProceduralWav({
      preset: cue.preset,
      seed: `${resolvedPlan.facts.cuePlanHash}:${index}:${cue.preset}`,
    })
    const file = path.join(
      workDirectory,
      `sfx-${String(index).padStart(2, '0')}-${cue.preset}.wav`
    )
    try {
      await writeFile(file, bytes)
    } catch (cause) {
      throw new ProceduralSfxMixError('程序化音效临时文件写入失败', {
        cause,
      })
    }
    inputs.push({ path: file, atFrame: cue.atFrame, gainDb: cue.gainDb })
    waveformHashes.push(createHash('sha256').update(bytes).digest('hex'))
  }
  return {
    inputs,
    result: {
      mode: 'procedural',
      status: 'applied',
      generatorVersion: PROCEDURAL_SFX_GENERATOR_VERSION,
      cueCount: inputs.length,
      timingHash: resolvedPlan.facts.timingHash,
      cuePlanHash: resolvedPlan.facts.cuePlanHash,
      waveformHashes,
    },
  }
}

export async function runMediaAssemblyWithSfxFallback(input: {
  baseInput: BaseAssemblyInput
  prepared: PreparedProceduralSfx
  runner: (args: string[]) => Promise<void>
}): Promise<ProceduralSfxMixResult> {
  if (input.prepared.inputs.length === 0) {
    await input.runner(buildMediaAssemblyArgs(input.baseInput))
    return input.prepared.result
  }
  try {
    await runSfxAssembly(input)
    return input.prepared.result
  } catch (error) {
    if (!(error instanceof ProceduralSfxMixError)) throw error
    await input.runner(buildMediaAssemblyArgs(input.baseInput))
    return {
      ...input.prepared.result,
      status: 'omitted-error',
      failureCode: 'PROCEDURAL_SFX_MIX_FAILED',
    }
  }
}

async function runSfxAssembly(input: {
  baseInput: BaseAssemblyInput
  prepared: PreparedProceduralSfx
  runner: (args: string[]) => Promise<void>
}): Promise<void> {
  try {
    await input.runner(
      buildMediaAssemblyArgs({
        ...input.baseInput,
        soundEffectInputs: input.prepared.inputs,
      })
    )
  } catch (cause) {
    throw new ProceduralSfxMixError('程序化音效混音失败', { cause })
  }
}

function baseResult(mode: ProceduralSfxMode): ProceduralSfxMixResult {
  return {
    mode,
    status: mode === 'off' ? 'omitted-off' : 'omitted-no-cues',
    generatorVersion: PROCEDURAL_SFX_GENERATOR_VERSION,
    cueCount: 0,
    timingHash: null,
    cuePlanHash: null,
    waveformHashes: [],
  }
}

function omitted(
  mode: ProceduralSfxMode,
  status: Extract<ProceduralSfxStatus, `omitted-${string}`>
): PreparedProceduralSfx {
  return { inputs: [], result: { ...baseResult(mode), status } }
}

function omittedError(): PreparedProceduralSfx {
  const prepared = omitted('procedural', 'omitted-error')
  return {
    ...prepared,
    result: {
      ...prepared.result,
      failureCode: 'PROCEDURAL_SFX_MIX_FAILED',
    },
  }
}
