import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { mapWithConcurrency } from '../ai/concurrency'
import type { ScriptVideoInput, ShotPlan } from '../contracts'
import { probeDuration } from '../media/ffmpeg'
import { registerFileArtifact } from '../state/artifacts'
import type { StateStore } from '../state/store'
import type { VoiceStore } from '../voice/voice-store'
import { buildTtsStylePrompt, hashPromptAssets } from '../workflow/prompts'
import type { MimoSpeechClient, SpeechAudioMimeType } from './mimo-client'

export interface ShotNarrationResult {
  id: string
  status: 'ready' | 'failed'
  path?: string
  durationSec?: number
  timelineDurationSec?: number
  errorCode?: string
}

export interface NarrationBatchResult {
  shots: ShotNarrationResult[]
  effectivePlans: ShotPlan[]
  failed: ShotNarrationResult[]
}

export interface ShotNarrationOptions {
  outputDir: string
  speech: MimoSpeechClient
  voiceStore: VoiceStore
  concurrency: number
  store: StateStore
  runDir: string
  forceShotIds?: ReadonlySet<string>
  tailBufferSec?: number
  signal?: AbortSignal
}

export async function synthesizeShotNarrations(
  input: ScriptVideoInput,
  plans: readonly ShotPlan[],
  options: ShotNarrationOptions,
): Promise<NarrationBatchResult> {
  const voice = await resolveActiveVoice(options.voiceStore)
  const shots = await mapWithConcurrency(
    plans,
    options.concurrency,
    async (plan) => synthesizeOne(input, plan, voice, options),
    { signal: options.signal },
  )
  const byId = new Map(shots.map((shot) => [shot.id, shot]))
  return {
    shots,
    failed: shots.filter((shot) => shot.status === 'failed'),
    effectivePlans: plans.map((plan) => {
      const narration = byId.get(plan.id)
      return narration?.timelineDurationSec ? { ...plan, durationSec: narration.timelineDurationSec } : plan
    }),
  }
}

async function synthesizeOne(
  input: ScriptVideoInput,
  plan: ShotPlan,
  voice: ActiveVoice,
  options: ShotNarrationOptions,
): Promise<ShotNarrationResult> {
  const unit = input.units.find((candidate) => candidate.id === plan.sourceUnitId)
  if (!unit) return { id: plan.id, status: 'failed', errorCode: 'TTS_TEXT_MISSING' }
  const key = `TTS:${plan.id}`
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ text: unit.text, plan, voiceHash: voice.sha256, prompt: hashPromptAssets(['tts-style']) }))
    .digest('hex')
  const previous = await options.store.readStage(options.runDir, key)
  const stored = previous?.status === 'succeeded' ? parseStored(previous.payload) : null
  if (
    !options.forceShotIds?.has(plan.id) &&
    previous?.fingerprint === fingerprint &&
    stored?.path &&
    (await exists(stored.path))
  ) {
    return stored
  }
  const attempt = (previous?.attempt ?? 0) + 1
  await options.store.writeStage(options.runDir, { key, status: 'running', attempt, fingerprint, payload: {} })
  try {
    const response = await options.speech.synthesize({
      text: unit.text,
      style: buildTtsStylePrompt(input, plan),
      voice: voice.id,
      ...(voice.sample ? { voiceSample: voice.sample } : {}),
      signal: options.signal,
    })
    const path = join(options.outputDir, 'shots', plan.id, 'narration.wav')
    await mkdir(join(options.outputDir, 'shots', plan.id), { recursive: true })
    await writeFile(path, response.audio)
    const durationSec = round(
      await probeDuration(path, { logPath: join(options.outputDir, 'logs', 'tts-ffprobe.log') }),
    )
    const result: ShotNarrationResult = {
      id: plan.id,
      status: 'ready',
      path,
      durationSec,
      timelineDurationSec: round(durationSec + (options.tailBufferSec ?? 0.35)),
    }
    const artifactId = `shot-${plan.id}-narration`
    await registerFileArtifact(options.store, options.runDir, {
      id: artifactId,
      kind: 'audio/wav',
      path,
      metadata: { durationSec },
    })
    await options.store.writeStage(options.runDir, {
      key,
      status: 'succeeded',
      attempt,
      fingerprint,
      artifactIds: [artifactId],
      payload: result,
    })
    return result
  } catch (error) {
    if (options.signal?.aborted) throw error
    const result: ShotNarrationResult = { id: plan.id, status: 'failed', errorCode: errorCode(error) }
    await options.store.writeStage(options.runDir, { key, status: 'failed', attempt, fingerprint, payload: result })
    return result
  }
}

interface ActiveVoice {
  id: string
  sha256: string
  sample?: { bytes: Uint8Array; mimeType: SpeechAudioMimeType }
}

async function resolveActiveVoice(store: VoiceStore): Promise<ActiveVoice> {
  const list = await store.list()
  if (list.activeVoice === 'mimo_default') return { id: 'mimo_default', sha256: 'mimo_default' }
  const voice = list.voices.find((candidate) => candidate.id === list.activeVoice)
  if (!voice) throw Object.assign(new Error('VOICE_NOT_FOUND'), { code: 'VOICE_NOT_FOUND' })
  return { id: voice.id, sha256: voice.sha256, sample: { bytes: await readFile(voice.path), mimeType: voice.mimeType } }
}

function parseStored(value: unknown): ShotNarrationResult | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.status !== 'ready' || typeof value.path !== 'string')
    return null
  if (typeof value.durationSec !== 'number' || typeof value.timelineDurationSec !== 'number') return null
  return {
    id: value.id,
    status: 'ready',
    path: value.path,
    durationSec: value.durationSec,
    timelineDurationSec: value.timelineDurationSec,
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : 'TTS_FAILED'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
