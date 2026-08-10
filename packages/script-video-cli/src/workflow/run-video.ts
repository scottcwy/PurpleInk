import { createHash } from 'node:crypto'
import { access } from 'node:fs/promises'
import { join } from 'node:path'

import type { CliArgs } from '../args'
import { createConfiguredAiClient, type CliConfig, WORKFLOW_VERSION } from '../config'
import { extractVideoFrames, muxVideoAudio } from '../media/ffmpeg'
import { inspectVideoArtifact } from '../qa/media'
import { renderHyperframesProject } from '../render/hyperframes'
import type { NarrationBatchResult } from '../speech/narration'
import { registerFileArtifact } from '../state/artifacts'
import { FileStateStore } from '../state/file-store'
import { assembleProject } from './assemble'
import { generateShots } from './codegen'
import { createPlan } from './plan'
import {
  assertNotCancelled,
  combineNarration,
  markRunFailed,
  persistPlan,
  prepareRun,
  registerAssemblyArtifacts,
  registerFinalArtifacts,
  resolveOutputDir,
  resolveWorkflowInput,
  synthesizeNarration,
  transcribePrepared,
  writeMetrics,
  type WorkflowRuntime,
} from './run-support'

export type { WorkflowRuntime } from './run-support'

export async function executePlanWorkflow(
  args: CliArgs,
  config: CliConfig,
  runtime: WorkflowRuntime,
): Promise<Record<string, unknown>> {
  const prepared = await prepareRun(args, config)
  const store = new FileStateStore(resolveOutputDir(args, config))
  try {
    await store.updateRun(prepared.run.runDir, { status: 'running' })
    const ai = runtime.channels.wrapAi(createConfiguredAiClient(config))
    const input = await resolveWorkflowInput(prepared, runtime, store, ai)
    const plan = await createPlan(input, ai, {
      store,
      runDir: prepared.run.runDir,
      concurrency: config.channels.text,
      signal: runtime.signal,
    })
    await persistPlan(store, prepared.run.runDir, plan)
    await store.updateRun(prepared.run.runDir, { status: 'succeeded' })
    await writeMetrics(prepared.run.runDir, runtime.channels)
    return {
      command: 'plan',
      runId: prepared.run.runId,
      runDir: prepared.run.runDir,
      fingerprint: plan.fingerprint,
      director: plan.director,
      shots: plan.shots,
    }
  } catch (error) {
    await markRunFailed(store, prepared.run.runDir, error)
    throw error
  }
}

export async function executeTranscribeWorkflow(
  args: CliArgs,
  config: CliConfig,
  runtime: WorkflowRuntime,
): Promise<Record<string, unknown>> {
  const prepared = await prepareRun(args, config, true)
  const store = new FileStateStore(resolveOutputDir(args, config))
  try {
    await store.updateRun(prepared.run.runDir, { status: 'running' })
    const result = await transcribePrepared(prepared, runtime, store)
    await store.updateRun(prepared.run.runDir, { status: 'succeeded' })
    await writeMetrics(prepared.run.runDir, runtime.channels)
    return {
      command: 'transcribe',
      runId: prepared.run.runId,
      runDir: prepared.run.runDir,
      transcriptPath: result.transcriptJsonPath,
      markdownPath: result.transcriptMarkdownPath,
      scriptPath: result.scriptPath,
      segmentCount: result.segments.length,
    }
  } catch (error) {
    await markRunFailed(store, prepared.run.runDir, error)
    throw error
  }
}

export async function executeVideoWorkflow(
  args: CliArgs,
  config: CliConfig,
  runtime: WorkflowRuntime,
): Promise<Record<string, unknown>> {
  const prepared = await prepareRun(args, config)
  const store = new FileStateStore(resolveOutputDir(args, config))
  const runDir = prepared.run.runDir
  try {
    await store.updateRun(runDir, { status: 'running' })
    await store.appendEvent(runDir, { type: 'run.started', data: { workflowVersion: WORKFLOW_VERSION } })
    await assertNotCancelled(runDir)
    const ai = runtime.channels.wrapAi(createConfiguredAiClient(config))
    const input = await resolveWorkflowInput(prepared, runtime, store, ai)
    const plan = await createPlan(input, ai, {
      store,
      runDir,
      concurrency: config.channels.text,
      signal: runtime.signal,
    })
    await persistPlan(store, runDir, plan)
    await assertNotCancelled(runDir)

    const narrationMode = args.narration ?? input.narration
    const narrationPromise =
      narrationMode === 'off'
        ? Promise.resolve<NarrationBatchResult>({ shots: [], effectivePlans: [...plan.shots], failed: [] })
        : synthesizeNarration(input, plan.shots, runtime, store, runDir)
    const [codegen, narration] = await Promise.all([
      generateShots(input, plan.shots, {
        ai,
        outputDir: runDir,
        concurrency: args.concurrency ?? config.channels.text,
        store,
        runDir,
        ...(args.shotId ? { forceShotIds: new Set([args.shotId]) } : {}),
        signal: runtime.signal,
      }),
      narrationPromise,
    ])
    if (codegen.failed.length > 0 || narration.failed.length > 0) {
      return finishNeedsAttention(store, prepared.run.runId, runDir, codegen.failed, narration, runtime)
    }

    await assertNotCancelled(runDir)
    const combinedAudioPath =
      narrationMode === 'off'
        ? null
        : await combineNarration(runDir, narration, runtime.channels, store, runtime.signal)
    const assemblyFingerprint = hashJson({
      assemblyVersion: 4,
      input,
      plans: narration.effectivePlans,
      audio: Boolean(combinedAudioPath),
      shots: codegen.succeeded.map((shot) => ({
        id: shot.id,
        attempt: shot.attempt,
        html: shot.relativeHtmlPath,
      })),
    })
    await store.writeStage(runDir, {
      key: 'ASSEMBLE',
      status: 'running',
      attempt: 1,
      fingerprint: assemblyFingerprint,
      payload: {},
    })
    const assembly = await assembleProject(input, narration.effectivePlans, codegen, {
      outputDir: runDir,
      narration: { mode: narrationMode, ...(combinedAudioPath ? { preparedAudioPath: combinedAudioPath } : {}) },
    })
    await registerAssemblyArtifacts(store, runDir, assembly)
    await store.writeStage(runDir, {
      key: 'ASSEMBLE',
      status: 'succeeded',
      attempt: 1,
      fingerprint: assemblyFingerprint,
      artifactIds: ['project-manifest', 'subtitles'],
      payload: { projectDir: assembly.projectDir, durationSec: assembly.durationSec },
    })

    const rendered = await renderVisual(store, runDir, assembly.projectDir, assemblyFingerprint, runtime)
    const finalVideoPath = await muxFinalVideo(
      store,
      runDir,
      rendered.videoPath,
      combinedAudioPath,
      narrationMode,
      runtime.signal,
    )
    const media = await observeFinalVideo(
      store,
      runDir,
      finalVideoPath,
      assembly.durationSec,
      narrationMode,
      runtime.signal,
    )
    await store.writeStage(runDir, {
      key: 'FINALIZE',
      status: 'running',
      attempt: 1,
      fingerprint: media.contentHash,
      payload: {},
    })
    await store.writeStage(runDir, {
      key: 'FINALIZE',
      status: 'succeeded',
      attempt: 1,
      fingerprint: media.contentHash,
      artifactIds: ['video'],
      payload: { videoPath: finalVideoPath },
    })
    const finalStatus = 'succeeded'
    await store.updateRun(runDir, { status: finalStatus })
    await store.appendEvent(runDir, { type: `run.${finalStatus}`, data: { videoPath: finalVideoPath } })
    await writeMetrics(runDir, runtime.channels)
    return {
      command: 'run',
      runId: prepared.run.runId,
      runDir,
      status: finalStatus,
      shotCount: plan.shots.length,
      videoPath: finalVideoPath,
      durationSec: media.metadata?.durationSec ?? assembly.durationSec,
      media: {
        observed: true,
        passed: media.passed,
        errors: media.errors,
        sizeBytes: media.sizeBytes,
        contentHash: media.contentHash,
        metadata: media.metadata,
      },
    }
  } catch (error) {
    await writeMetrics(runDir, runtime.channels).catch(() => undefined)
    await markRunFailed(store, runDir, error)
    throw error
  }
}

async function finishNeedsAttention(
  store: FileStateStore,
  runId: string,
  runDir: string,
  failedShots: Array<{ id: string }>,
  narration: NarrationBatchResult,
  runtime: WorkflowRuntime,
): Promise<Record<string, unknown>> {
  await store.updateRun(runDir, { status: 'needs_attention' })
  await store.appendEvent(runDir, {
    type: 'run.needs_attention',
    data: { failedShots: failedShots.map((shot) => shot.id), failedNarration: narration.failed.map((shot) => shot.id) },
  })
  await writeMetrics(runDir, runtime.channels)
  return {
    command: 'run',
    runId,
    runDir,
    status: 'needs_attention',
    failedShots,
    failedNarration: narration.failed,
    videoPath: null,
  }
}

async function renderVisual(
  store: FileStateStore,
  runDir: string,
  projectDir: string,
  fingerprint: string,
  runtime: WorkflowRuntime,
): Promise<{ videoPath: string }> {
  await assertNotCancelled(runDir)
  const previous = await store.readStage(runDir, 'RENDER')
  if (
    previous?.status === 'succeeded' &&
    previous.fingerprint === fingerprint &&
    isRecord(previous.payload) &&
    typeof previous.payload.videoPath === 'string' &&
    (await pathExists(previous.payload.videoPath))
  ) {
    return { videoPath: previous.payload.videoPath }
  }
  await store.writeStage(runDir, { key: 'RENDER', status: 'running', attempt: 1, fingerprint, payload: {} })
  try {
    const rendered = await runtime.channels.run('render', () =>
      renderHyperframesProject(projectDir, {
        fps: 30,
        logPath: join(runDir, 'logs', 'hyperframes.log'),
        signal: runtime.signal,
      }),
    )
    await registerFileArtifact(store, runDir, { id: 'visual-render', kind: 'video/mp4', path: rendered.videoPath })
    await store.writeStage(runDir, {
      key: 'RENDER',
      status: 'succeeded',
      attempt: 1,
      fingerprint,
      artifactIds: ['visual-render'],
      payload: { videoPath: rendered.videoPath },
    })
    return rendered
  } catch (error) {
    await store.writeStage(runDir, {
      key: 'RENDER',
      status: 'failed',
      attempt: 1,
      fingerprint,
      payload: { code: safeStageErrorCode(error, 'RENDER_FAILED') },
    })
    throw error
  }
}

async function muxFinalVideo(
  store: FileStateStore,
  runDir: string,
  visualPath: string,
  audioPath: string | null,
  narrationMode: string,
  signal?: AbortSignal,
): Promise<string> {
  const fingerprint = hashJson({ visualPath, narrationMode })
  const finalPath = join(runDir, 'final', 'video.mp4')
  const previous = await store.readStage(runDir, 'AUDIO_MUX')
  if (previous?.status === 'succeeded' && previous.fingerprint === fingerprint && (await pathExists(finalPath))) {
    return finalPath
  }
  await store.writeStage(runDir, { key: 'AUDIO_MUX', status: 'running', attempt: 1, fingerprint, payload: {} })
  try {
    await muxVideoAudio(visualPath, audioPath, finalPath, { logPath: join(runDir, 'logs', 'ffmpeg.log'), signal })
  } catch (error) {
    await store.writeStage(runDir, {
      key: 'AUDIO_MUX',
      status: 'failed',
      attempt: 1,
      fingerprint,
      payload: { code: safeStageErrorCode(error, 'AUDIO_MUX_FAILED') },
    })
    throw error
  }
  await store.writeStage(runDir, {
    key: 'AUDIO_MUX',
    status: 'succeeded',
    attempt: 1,
    fingerprint,
    payload: { finalPath },
  })
  return finalPath
}

async function observeFinalVideo(
  store: FileStateStore,
  runDir: string,
  videoPath: string,
  durationSec: number,
  narrationMode: string,
  signal?: AbortSignal,
) {
  const fingerprint = hashJson({ videoPath, durationSec, narrationMode })
  await store.writeStage(runDir, { key: 'MEDIA_QA', status: 'running', attempt: 1, fingerprint, payload: {} })
  const media = await inspectVideoArtifact(videoPath, {
    expectedDurationSec: durationSec,
    durationToleranceSec: 0.4,
    expectedWidth: 1920,
    expectedHeight: 1080,
    expectedFps: 30,
    expectedVideoCodec: 'h264',
    requireAudio: narrationMode !== 'off',
    ...(narrationMode !== 'off' ? { expectedAudioCodec: 'aac' } : {}),
  })
  const frames = await extractVideoFrames(videoPath, join(runDir, 'final', 'frames'), durationSec, {
    logPath: join(runDir, 'logs', 'ffmpeg.log'),
    signal,
  }).catch(() => [])
  await registerFinalArtifacts(store, runDir, videoPath, frames, media)
  const frameArtifactIds = frames.map((_path, index) => `final-frame-${['000', '050', '100'][index]}`)
  await store.writeStage(runDir, {
    key: 'MEDIA_QA',
    status: 'succeeded',
    attempt: 1,
    fingerprint,
    artifactIds: ['video', ...frameArtifactIds],
    payload: {
      observed: true,
      passed: media.passed,
      errors: media.errors,
      metadata: media.metadata,
      sizeBytes: media.sizeBytes,
      contentHash: media.contentHash,
      frameCount: frames.length,
    },
  })
  return media
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}

function safeStageErrorCode(error: unknown, fallback: string): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code.slice(0, 80)
    : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
