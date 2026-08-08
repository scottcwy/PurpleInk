import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

import { createOpenAiCompatibleClient } from '../ai/openai-compatible'
import type { CliArgs } from '../args'
import type { CliConfig } from '../config'
import { WORKFLOW_VERSION } from '../config'
import type { ScriptVideoInput, ShotPlan } from '../contracts'
import { readScriptFile } from '../input'
import { concatShotAudio } from '../media/ffmpeg'
import type { MediaQaResult } from '../qa/media'
import { ConcurrencyChannels } from '../runtime/channels'
import { SafeCliError } from '../safe-error'
import { createMimoSpeechClient, type MimoSpeechClient } from '../speech/mimo-client'
import { synthesizeShotNarrations, type NarrationBatchResult } from '../speech/narration'
import { transcribeAudio, type TranscriptionResult } from '../speech/transcription'
import { registerFileArtifact } from '../state/artifacts'
import { FileStateStore } from '../state/file-store'
import type { RunRecord, StateStore } from '../state/store'
import type { LocalConfigStore } from '../local-config'
import type { VoiceStore } from '../voice/voice-store'
import type { PlanResult } from './plan'

export interface WorkflowRuntime {
  localStore: LocalConfigStore
  voiceStore: VoiceStore
  channels: ConcurrencyChannels
  output?: { writeLine(line: string): void }
  signal?: AbortSignal
}

export interface PreparedRun {
  run: RunRecord
  sourcePath: string
  sourceHash: string
  input?: ScriptVideoInput
  audio: boolean
}

export async function prepareRun(args: CliArgs, config: CliConfig, requireAudio = false): Promise<PreparedRun> {
  if (!args.inputPath) throw new SafeCliError('INPUT_REQUIRED', '命令需要输入文件。', false, 400)
  const sourcePath = resolveUserPath(args.inputPath)
  const bytes = await readFile(sourcePath)
  const sourceHash = createHash('sha256').update(bytes).digest('hex')
  const audio = ['.wav', '.mp3'].includes(extname(sourcePath).toLowerCase())
  if (requireAudio && !audio)
    throw new SafeCliError('AUDIO_INPUT_REQUIRED', 'transcribe 只接受 WAV 或 MP3。', false, 400)
  const input = audio ? undefined : (await readScriptFile(sourcePath)).input
  const store = new FileStateStore(resolveOutputDir(args, config))
  let run: RunRecord
  if (args.resumeDir) {
    const runDir = resolveUserPath(args.resumeDir)
    await store.assertResumeCompatible(runDir, { inputHash: sourceHash, workflowVersion: WORKFLOW_VERSION })
    run = await store.readRun(runDir)
  } else {
    run = await store.createRun({
      inputHash: sourceHash,
      title: input?.title ?? basename(sourcePath, extname(sourcePath)),
      workflowVersion: WORKFLOW_VERSION,
    })
    await copyFile(sourcePath, join(run.runDir, 'input', basename(sourcePath)))
  }
  const sourceCopy = join(run.runDir, 'input', basename(sourcePath))
  await registerFileArtifact(store, run.runDir, {
    id: 'source-input',
    kind: audio ? audioKind(sourcePath) : 'text/plain',
    path: sourceCopy,
  })
  await store.writeStage(run.runDir, {
    key: 'INGEST',
    status: 'succeeded',
    attempt: 1,
    fingerprint: sourceHash,
    artifactIds: ['source-input'],
    payload: { sourcePath: sourceCopy, audio },
  })
  return { run, sourcePath: sourceCopy, sourceHash, input, audio }
}

export async function resolveWorkflowInput(
  prepared: PreparedRun,
  runtime: WorkflowRuntime,
  store: StateStore,
): Promise<ScriptVideoInput> {
  if (prepared.input) return prepared.input
  return (await transcribePrepared(prepared, runtime, store)).input
}

export async function transcribePrepared(
  prepared: PreparedRun,
  runtime: WorkflowRuntime,
  store: StateStore,
): Promise<TranscriptionResult> {
  const speech = limitSpeech(createMimoSpeechClient(await runtime.localStore.loadSpeechProvider()), runtime.channels)
  const textConfig = await runtime.localStore.loadTextProvider()
  const ai = runtime.channels.wrapAi(createOpenAiCompatibleClient(textConfig))
  return transcribeAudio(prepared.sourcePath, {
    outputDir: prepared.run.runDir,
    ai,
    speech,
    concurrency: runtime.channels.limits.asr,
    store,
    runDir: prepared.run.runDir,
    signal: runtime.signal,
  })
}

export async function synthesizeNarration(
  input: ScriptVideoInput,
  plans: readonly ShotPlan[],
  runtime: WorkflowRuntime,
  store: StateStore,
  runDir: string,
  retryShot?: string,
): Promise<NarrationBatchResult> {
  const speech = limitSpeech(createMimoSpeechClient(await runtime.localStore.loadSpeechProvider()), runtime.channels)
  return synthesizeShotNarrations(input, plans, {
    outputDir: runDir,
    speech,
    voiceStore: runtime.voiceStore,
    concurrency: runtime.channels.limits.tts,
    store,
    runDir,
    ...(retryShot ? { forceShotIds: new Set([retryShot]) } : {}),
    signal: runtime.signal,
  })
}

export async function combineNarration(
  runDir: string,
  narration: NarrationBatchResult,
  channels: ConcurrencyChannels,
  store: StateStore,
  signal?: AbortSignal,
): Promise<string> {
  const path = join(runDir, 'audio', 'narration.wav')
  const ready = narration.shots.map((shot) => ({ path: shot.path!, durationSec: shot.timelineDurationSec! }))
  await channels.run('render', () =>
    concatShotAudio(ready, path, { logPath: join(runDir, 'logs', 'ffmpeg.log'), signal }),
  )
  await registerFileArtifact(store, runDir, { id: 'narration', kind: 'audio/wav', path })
  return path
}

export async function persistPlan(store: StateStore, runDir: string, plan: PlanResult): Promise<void> {
  const directorPath = join(runDir, 'state', 'director.json')
  await writeFile(directorPath, `${JSON.stringify(plan.director, null, 2)}\n`, 'utf8')
  await registerFileArtifact(store, runDir, { id: 'director-plan', kind: 'application/json', path: directorPath })
  await Promise.all(
    plan.shots.map(async (shot) => {
      const path = join(runDir, 'shots', shot.id, 'plan.json')
      await mkdir(join(runDir, 'shots', shot.id), { recursive: true })
      await writeFile(path, `${JSON.stringify(shot, null, 2)}\n`, 'utf8')
      await registerFileArtifact(store, runDir, { id: `shot-${shot.id}-plan`, kind: 'application/json', path })
    }),
  )
}

export async function registerAssemblyArtifacts(
  store: StateStore,
  runDir: string,
  assembly: { manifestPath: string; subtitlePath: string },
): Promise<void> {
  await Promise.all([
    registerFileArtifact(store, runDir, {
      id: 'project-manifest',
      kind: 'application/json',
      path: assembly.manifestPath,
    }),
    registerFileArtifact(store, runDir, { id: 'subtitles', kind: 'text/srt', path: assembly.subtitlePath }),
  ])
}

export async function registerFinalArtifacts(
  store: StateStore,
  runDir: string,
  videoPath: string,
  frames: string[],
  media: MediaQaResult,
): Promise<void> {
  await registerFileArtifact(store, runDir, {
    id: 'video',
    kind: 'video/mp4',
    path: videoPath,
    metadata: media.metadata ? { ...media.metadata } : {},
  })
  await Promise.all(
    frames.map((path, index) =>
      registerFileArtifact(store, runDir, {
        id: `final-frame-${['000', '050', '100'][index]}`,
        kind: 'image/png',
        path,
      }),
    ),
  )
}

export async function writeMetrics(runDir: string, channels: ConcurrencyChannels): Promise<void> {
  await mkdir(join(runDir, 'state'), { recursive: true })
  await writeFile(join(runDir, 'state', 'metrics.json'), `${JSON.stringify(channels.snapshot(), null, 2)}\n`, 'utf8')
}

export async function assertNotCancelled(runDir: string): Promise<void> {
  try {
    await access(join(runDir, 'state', 'cancel.request'))
    throw new SafeCliError('RUN_CANCELLED', '运行已取消。', false, 409)
  } catch (error) {
    if (error instanceof SafeCliError) throw error
  }
}

export async function markRunFailed(store: StateStore, runDir: string, error: unknown): Promise<void> {
  const code = errorCode(error)
  const status = code === 'RUN_CANCELLED' ? 'cancelled' : 'failed'
  await store.updateRun(runDir, { status }).catch(() => undefined)
  await store.appendEvent(runDir, { type: `run.${status}`, data: { code } }).catch(() => undefined)
}

export async function findRunInput(runDir: string): Promise<string> {
  const candidates = (await readdir(join(runDir, 'input'))).filter((name) =>
    ['.json', '.md', '.wav', '.mp3'].includes(extname(name).toLowerCase()),
  )
  const original = candidates.find((name) => name !== 'script.json') ?? candidates[0]
  if (!original) throw new SafeCliError('RUN_INPUT_MISSING', 'run 缺少原始输入。', false, 422)
  return join(runDir, 'input', original)
}

export function resolveOutputDir(args: CliArgs, config: CliConfig): string {
  return args.outputDir ? resolveUserPath(args.outputDir) : config.stateDir
}

export function resolveUserPath(path: string): string {
  return resolve(process.env.INIT_CWD?.trim() || process.cwd(), path)
}

function limitSpeech(client: MimoSpeechClient, channels: ConcurrencyChannels): MimoSpeechClient {
  return {
    synthesize: (input) => channels.run('tts', () => client.synthesize(input)),
    transcribe: (input) => channels.run('asr', () => client.transcribe(input)),
  }
}

function audioKind(path: string): string {
  return extname(path).toLowerCase() === '.wav' ? 'audio/wav' : 'audio/mpeg'
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'CLI_FAILED'
}
