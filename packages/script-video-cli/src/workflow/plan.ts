import { createHash } from 'node:crypto'

import {
  directorPlanSchema,
  shotPlanSchema,
  type DirectorPlan,
  type ScriptUnit,
  type ScriptVideoInput,
  type ShotPlan,
} from '../contracts'
import type { AiClient } from '../ai/openai-compatible'
import { completeJsonWithRepair } from '../ai/structured-output'
import type { StateStore, StageRecord } from '../state/store'
import { buildDirectPrompt, buildShotSpecPrompt, hashPromptAssets } from './prompts'

export interface PlanOptions {
  store?: StateStore
  runDir?: string
  signal?: AbortSignal
}

export interface PlanResult {
  director: DirectorPlan
  shots: ShotPlan[]
  fingerprint: string
  promptFingerprint: string
}

export class PlanContractError extends Error {
  readonly code = 'AI_OUTPUT_INVALID' as const

  constructor(message: string, options?: { cause?: unknown }) {
    super(`AI_OUTPUT_INVALID: ${message}`, options)
    this.name = 'PlanContractError'
  }
}

export async function createPlan(
  input: ScriptVideoInput,
  ai: AiClient,
  options: PlanOptions = {},
): Promise<PlanResult> {
  const state = requireStatePair(options)
  const directPromptFingerprint = hashPromptAssets(['direct'])
  const shotPromptFingerprint = hashPromptAssets(['shot-spec'])
  const promptFingerprint = hashPromptAssets(['direct', 'shot-spec'])
  const directorFingerprint = fingerprint({ stage: 'DIRECT', input, promptFingerprint: directPromptFingerprint })
  const director = await runDirectorStage(input, ai, state, directorFingerprint, options.signal)
  const shots: ShotPlan[] = []

  for (const [index, unit] of input.units.entries()) {
    options.signal?.throwIfAborted()
    const id = `S${String(index + 1).padStart(3, '0')}`
    const shotFingerprint = fingerprint({
      stage: 'SHOT_SPEC',
      input,
      director,
      unit,
      id,
      promptFingerprint: shotPromptFingerprint,
    })
    const shot = await runShotStage(input, director, unit, id, ai, state, shotFingerprint, options.signal)
    shots.push(shot)
  }

  return {
    director,
    shots,
    fingerprint: fingerprint({ input, director, shots, promptFingerprint }),
    promptFingerprint,
  }
}

type StatePair = { store: StateStore; runDir: string } | null

function requireStatePair(options: PlanOptions): StatePair {
  if ((options.store && !options.runDir) || (!options.store && options.runDir)) {
    throw new Error('StateStore 和 runDir 必须同时提供')
  }
  return options.store && options.runDir ? { store: options.store, runDir: options.runDir } : null
}

async function runDirectorStage(
  input: ScriptVideoInput,
  ai: AiClient,
  state: StatePair,
  stageFingerprint: string,
  signal?: AbortSignal,
): Promise<DirectorPlan> {
  const stored = await readStoredStage(state, 'DIRECT', stageFingerprint, directorPlanSchema.parse)
  if (stored) return stored
  await writeStageState(state, 'DIRECT', 'running', 1, stageFingerprint, {})
  try {
    const parsed = await completeJsonWithRepair({
      ai,
      schema: directorPlanSchema,
      stage: 'DIRECT',
      prompt: { ...buildDirectPrompt(input), signal },
    })
    await writeStageState(state, 'DIRECT', 'succeeded', 1, stageFingerprint, parsed)
    return parsed
  } catch (error) {
    await writeStageState(state, 'DIRECT', 'failed', 1, stageFingerprint, {
      code: error instanceof PlanContractError ? error.code : 'AI_PROVIDER_ERROR',
    })
    throw error
  }
}

async function runShotStage(
  input: ScriptVideoInput,
  director: DirectorPlan,
  unit: ScriptUnit,
  id: string,
  ai: AiClient,
  state: StatePair,
  stageFingerprint: string,
  signal?: AbortSignal,
): Promise<ShotPlan> {
  const key = `SHOT_SPEC:${id}`
  const stored = await readStoredStage(state, key, stageFingerprint, shotPlanSchema.parse)
  if (stored) return validateShotBinding(stored, unit, id)
  await writeStageState(state, key, 'running', 1, stageFingerprint, {})
  try {
    const parsed = await completeJsonWithRepair({
      ai,
      schema: shotPlanSchema,
      stage: key,
      prompt: { ...buildShotSpecPrompt(input, director, unit, id), signal },
    })
    const validated = validateShotBinding(parsed, unit, id)
    await writeStageState(state, key, 'succeeded', 1, stageFingerprint, validated)
    return validated
  } catch (error) {
    await writeStageState(state, key, 'failed', 1, stageFingerprint, {
      code: error instanceof PlanContractError ? error.code : 'AI_PROVIDER_ERROR',
    })
    throw error
  }
}

function validateShotBinding(shot: ShotPlan, unit: ScriptUnit, expectedId: string): ShotPlan {
  if (shot.id !== expectedId) throw new PlanContractError(`${expectedId} 的 shot id 不匹配`)
  if (shot.sourceUnitId !== unit.id) {
    throw new PlanContractError(`${expectedId} 的 sourceUnitId 不匹配`)
  }
  const sourceText = unit.text.replace(/\s+/gu, '')
  for (const fact of shot.facts) {
    if (!sourceText.includes(fact.replace(/\s+/gu, ''))) {
      throw new PlanContractError(`${expectedId} 的 fact 不在来源原文中`)
    }
  }
  return shot
}

async function readStoredStage<T>(
  state: StatePair,
  key: string,
  expectedFingerprint: string,
  parse: (value: unknown) => T,
): Promise<T | null> {
  if (!state) return null
  const stored = await state.store.readStage(state.runDir, key)
  if (!stored || stored.status !== 'succeeded' || stored.fingerprint !== expectedFingerprint) return null
  try {
    return parse(stored.payload)
  } catch {
    return null
  }
}

async function writeStageState(
  state: StatePair,
  key: string,
  status: StageRecord['status'],
  attempt: number,
  fingerprint: string,
  payload: unknown,
): Promise<void> {
  if (!state) return
  await state.store.writeStage(state.runDir, { key, status, attempt, fingerprint, payload })
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}
