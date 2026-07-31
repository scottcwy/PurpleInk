import 'server-only'
import { ProviderQueueDeferral } from '@/features/ai/provider-queue-deferral'
import { type ShotLaneSeed } from '@/features/canvas'
import { classifyWorkflowError } from '@/features/canvas/workflow-error'
import { shotIdFor } from '@/features/director/audio-timing'
import type { ScriptUnit } from '@/features/director/schemas/ingest'
import type { NodeExecutionFence } from '@/lib/db/transaction'
import { sliceDecodedUserRecording } from './user-audio-slicer'
import {
  buildUserAudioTimeline,
  type UserAudioTimeline,
} from './user-audio-timeline'
import {
  audioTranscriptionJobSchema,
  transcriptSchema,
  verifyDecodedMetadata,
  verifySourceBytes,
  type AudioTranscriptionDependencies,
  type AudioTranscriptionExecution,
  type AudioTranscriptionJobInput,
  type AudioTranscriptionState,
} from './audio-transcription-contract'
import { createAudioTranscriptionDependencies } from './audio-transcription-runtime'

export {
  AudioSourceIntegrityError,
  verifyDecodedMetadata,
  verifySourceBytes,
  type AudioTranscriptionDependencies,
  type AudioTranscriptionExecution,
  type AudioTranscriptionJobInput,
  type AudioTranscriptionState,
  type LoadedAudioProjectSource,
} from './audio-transcription-contract'

/**
 * 录音工作流入口：原音频只解码一次，ASR 后直接复用 PCM 构造时间线与 WAV 切片。
 * 依赖合同刻意不包含 TTS/synthesize，避免录音路径误入二次配音。
 */
export async function runAudioTranscriptionJob(
  input: AudioTranscriptionJobInput,
  dependencies?: AudioTranscriptionDependencies,
  execution?: AudioTranscriptionExecution,
): Promise<void> {
  const payload = audioTranscriptionJobSchema.parse(input)
  const resolved = dependencies ?? (await createAudioTranscriptionDependencies())
  const fence = executionFence(payload, execution)
  await assertActive(resolved, payload.nodeId, fence)
  await transition(resolved, payload.nodeId, 'running', fence)

  try {
    await recordState(resolved, payload.nodeId, {
      status: 'running',
      startedAt: resolved.now().toISOString(),
    }, undefined, fence)
    await assertActive(resolved, payload.nodeId, fence)
    const loaded = await resolved.loadSource(payload.projectId)
    const sourceBytes = await resolved.readSourceBytes(loaded.source.storageKey)
    verifySourceBytes(loaded, sourceBytes)
    await assertActive(resolved, payload.nodeId, fence)
    const sourceArtifact = await resolved.persistSource({
      projectId: payload.projectId,
      nodeId: payload.nodeId,
      attemptId: payload.billingContext.attemptId,
      source: loaded.source,
      sourceContentHash: loaded.sourceFingerprint,
      sourceBytes,
    })

    await assertActive(resolved, payload.nodeId, fence)
    const decoded = await resolved.decode(sourceBytes)
    verifyDecodedMetadata(loaded.source, decoded)
    await assertActive(resolved, payload.nodeId, fence)
    const speech = await resolved.transcribe({
      audioBytes: sourceBytes,
      audioFormat: loaded.source.container,
      audioSeconds: decoded.measured.durationMs / 1_000,
      billingContext: payload.billingContext,
      ...(fence?.signal ? { signal: fence.signal } : {}),
    })
    await assertActive(resolved, payload.nodeId, fence)
    const transcript = transcriptSchema.parse(speech.transcript)
    const timeline = buildUserAudioTimeline({
      transcript,
      captions: speech.captions,
      measured: decoded.measured,
    })
    const slices = sliceDecodedUserRecording(decoded, timeline)
    await assertActive(resolved, payload.nodeId, fence)
    const persisted = await resolved.persistArtifacts({
      projectId: payload.projectId,
      nodeId: payload.nodeId,
      attemptId: payload.billingContext.attemptId,
      sourceArtifact,
      timeline,
      slices,
    })

    await assertActive(resolved, payload.nodeId, fence)
    await updateProjectScript(resolved, payload.projectId, transcript, fence)
    await assertActive(resolved, payload.nodeId, fence)
    await materialize(resolved, payload.projectId, shotSeeds(timeline), fence)
    await assertActive(resolved, payload.nodeId, fence)
    await recordState(
      resolved,
      payload.nodeId,
      {
        status: 'ready',
        ingestArtifactId: persisted.ingestArtifactId,
        audioArtifactId: persisted.ingestAudioArtifactId,
        unitCount: timeline.scriptUnits.length,
        alignmentMode: timeline.alignmentMode,
        alignmentSource: speech.alignmentSource,
        completedAt: resolved.now().toISOString(),
      },
      persisted.ingestContentHash,
      fence,
    )
    await assertActive(resolved, payload.nodeId, fence)
    await activateContinuation(
      resolved,
      payload.projectId,
      payload.nodeId,
      fence,
    )
    await assertActive(resolved, payload.nodeId, fence)
    await transition(resolved, payload.nodeId, 'success', fence)
  } catch (error) {
    if (isStoppedExecution(error, fence)) throw error
    await assertActive(resolved, payload.nodeId, fence)
    if (error instanceof ProviderQueueDeferral && error.retryAt) {
      await settleDispatchWait(payload.nodeId, error, error.retryAt, resolved, fence)
    } else {
      await settleFailure(payload.nodeId, error, resolved, fence)
    }
    throw error
  }

  await assertActive(resolved, payload.nodeId, fence)
  await advanceWithoutMasking(
    resolved,
    payload.projectId,
    payload.nodeId,
    fence,
  )
}

function shotSeeds(timeline: UserAudioTimeline): ShotLaneSeed[] {
  return timeline.scriptUnits.map((unit, index) => ({
    shotId: shotIdFor(index),
    sourceUnit: unit satisfies ScriptUnit,
  }))
}

async function settleDispatchWait(
  nodeId: string,
  error: ProviderQueueDeferral,
  retryAt: string,
  dependencies: AudioTranscriptionDependencies,
  execution?: NodeExecutionFence,
): Promise<void> {
  const cleanupErrors: unknown[] = []
  try {
    await recordState(dependencies, nodeId, {
      status: 'waiting',
      code: 'PROVIDER_POOL_WAIT',
      message: `${error.providerLabel}正在等待可用调用窗口`,
      resumeAt: retryAt,
      providerLabel: error.providerLabel,
    }, undefined, execution)
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [error, ...cleanupErrors],
      '录音转写等待调度且节点状态未完整收敛',
    )
  }
}

async function settleFailure(
  nodeId: string,
  error: unknown,
  dependencies: AudioTranscriptionDependencies,
  execution?: NodeExecutionFence,
): Promise<void> {
  const cleanupErrors: unknown[] = []
  const projection = classifyWorkflowError(error, {
    stage: 'INGEST',
    sourceNodeId: nodeId,
  })
  try {
    await recordState(dependencies, nodeId, {
      status: 'failed',
      error: projection,
      completedAt: dependencies.now().toISOString(),
    }, undefined, execution)
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
  }
  try {
    await transition(dependencies, nodeId, 'failed', execution)
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [error, ...cleanupErrors],
      '录音转写失败且节点清理不完整',
    )
  }
}

async function advanceWithoutMasking(
  dependencies: AudioTranscriptionDependencies,
  projectId: string,
  nodeId: string,
  execution?: NodeExecutionFence,
): Promise<void> {
  try {
    if (execution) {
      await dependencies.advance(projectId, nodeId, execution)
    } else {
      await dependencies.advance(projectId, nodeId)
    }
  } catch (error) {
    console.error('[audio-transcription] 下游自动推进失败', {
      projectId,
      nodeId,
      errorName: error instanceof Error ? error.name : 'NonErrorThrown',
    })
  }
}

async function assertActive(
  dependencies: AudioTranscriptionDependencies,
  nodeId: string,
  execution?: NodeExecutionFence,
): Promise<void> {
  execution?.signal?.throwIfAborted()
  if (execution) await dependencies.assertActive(nodeId, execution)
  execution?.signal?.throwIfAborted()
}

function executionFence(
  payload: AudioTranscriptionJobInput,
  execution?: AudioTranscriptionExecution,
): NodeExecutionFence | undefined {
  if (!execution) return undefined
  if (execution.attemptId !== payload.billingContext.attemptId) {
    throw new Error('音频任务执行身份与计费 attempt 不一致')
  }
  return {
    projectId: payload.projectId,
    attemptId: execution.attemptId,
    ...(execution.signal ? { signal: execution.signal } : {}),
  }
}

function isStoppedExecution(
  error: unknown,
  execution?: NodeExecutionFence,
): boolean {
  return execution?.signal?.aborted === true
    || (error instanceof Error && error.message === 'STALE_ATTEMPT')
}

function transition(
  dependencies: AudioTranscriptionDependencies,
  nodeId: string,
  status: 'running' | 'success' | 'failed',
  execution?: NodeExecutionFence,
): Promise<void> {
  return execution
    ? dependencies.transition(nodeId, status, execution)
    : dependencies.transition(nodeId, status)
}

function recordState(
  dependencies: AudioTranscriptionDependencies,
  nodeId: string,
  state: AudioTranscriptionState,
  outputContentHash?: string,
  execution?: NodeExecutionFence,
): Promise<void> {
  if (execution) {
    return dependencies.recordState(nodeId, state, outputContentHash, execution)
  }
  return outputContentHash === undefined
    ? dependencies.recordState(nodeId, state)
    : dependencies.recordState(nodeId, state, outputContentHash)
}

function updateProjectScript(
  dependencies: AudioTranscriptionDependencies,
  projectId: string,
  transcript: string,
  execution?: NodeExecutionFence,
): Promise<void> {
  return execution
    ? dependencies.updateProjectScript(projectId, transcript, execution)
    : dependencies.updateProjectScript(projectId, transcript)
}

function materialize(
  dependencies: AudioTranscriptionDependencies,
  projectId: string,
  shots: readonly ShotLaneSeed[],
  execution?: NodeExecutionFence,
): Promise<void> {
  return execution
    ? dependencies.materialize(projectId, shots, execution)
    : dependencies.materialize(projectId, shots)
}

function activateContinuation(
  dependencies: AudioTranscriptionDependencies,
  projectId: string,
  nodeId: string,
  execution?: NodeExecutionFence,
): Promise<void> {
  return execution
    ? dependencies.activateContinuation(projectId, nodeId, execution)
    : dependencies.activateContinuation(projectId, nodeId)
}
