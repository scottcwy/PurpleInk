import { createHash } from 'node:crypto'
import { join } from 'node:path'

import type { CliArgs } from '../args'
import { createConfiguredAiClient, type CliConfig, WORKFLOW_VERSION } from '../config'
import { extractVideoFrames, muxVideoAudio } from '../media/ffmpeg'
import { inspectVideoArtifact } from '../qa/media'
import { renderHyperframesProject } from '../render/hyperframes'
import { SafeCliError } from '../safe-error'
import type { NarrationBatchResult } from '../speech/narration'
import { registerFileArtifact } from '../state/artifacts'
import { FileStateStore } from '../state/file-store'
import { assembleProject } from './assemble'
import { generateShots } from './codegen'
import { runChromiumGate } from './gates'
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
    const input = await resolveWorkflowInput(prepared, runtime, store)
    const ai = runtime.channels.wrapAi(createConfiguredAiClient(config))
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
    const input = await resolveWorkflowInput(prepared, runtime, store)
    const ai = runtime.channels.wrapAi(createConfiguredAiClient(config))
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
        : synthesizeNarration(input, plan.shots, runtime, store, runDir, args.shotId)
    const [codegen, narration] = await Promise.all([
      generateShots(input, plan.shots, {
        ai,
        outputDir: runDir,
        concurrency: args.concurrency ?? config.channels.text,
        runtimeGate: args.skipBrowserGate
          ? async () => ({ passed: true, errors: [], screenshotHashes: [] })
          : (path, attemptDir) =>
              runtime.channels.run('browser', () => runChromiumGate(path, { outputDir: attemptDir })),
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
    const assemblyFingerprint = hashJson({ input, plans: narration.effectivePlans, audio: Boolean(combinedAudioPath) })
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
    const media = await verifyFinalVideo(
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
    const finalStatus = args.skipBrowserGate ? 'degraded' : 'succeeded'
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
      durationSec: media.metadata?.durationSec,
      media: { sizeBytes: media.sizeBytes, contentHash: media.contentHash, metadata: media.metadata },
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
  await store.writeStage(runDir, { key: 'RENDER', status: 'running', attempt: 1, fingerprint, payload: {} })
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
  await store.writeStage(runDir, { key: 'AUDIO_MUX', status: 'running', attempt: 1, fingerprint, payload: {} })
  await muxVideoAudio(visualPath, audioPath, finalPath, { logPath: join(runDir, 'logs', 'ffmpeg.log'), signal })
  await store.writeStage(runDir, {
    key: 'AUDIO_MUX',
    status: 'succeeded',
    attempt: 1,
    fingerprint,
    payload: { finalPath },
  })
  return finalPath
}

async function verifyFinalVideo(
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
  if (!media.passed)
    throw new SafeCliError('MEDIA_QA_FAILED', '最终视频媒体 QA 未通过。', false, 422, { stageKey: 'MEDIA_QA' })
  const frames = await extractVideoFrames(videoPath, join(runDir, 'final', 'frames'), durationSec, {
    logPath: join(runDir, 'logs', 'ffmpeg.log'),
    signal,
  })
  await registerFinalArtifacts(store, runDir, videoPath, frames, media)
  await store.writeStage(runDir, {
    key: 'MEDIA_QA',
    status: 'succeeded',
    attempt: 1,
    fingerprint,
    artifactIds: ['video', 'final-frame-000', 'final-frame-050', 'final-frame-100'],
    payload: { metadata: media.metadata, sizeBytes: media.sizeBytes, contentHash: media.contentHash },
  })
  return media
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}
