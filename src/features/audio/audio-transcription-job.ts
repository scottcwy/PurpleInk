import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ProviderDispatchWaitError } from '@/features/ai/provider-dispatch-wait-error'
import {
  type ShotLaneSeed,
} from '@/features/canvas'
import {
  classifyWorkflowError,
  type WorkflowErrorProjection,
  type WorkflowExecutionNotice,
} from '@/features/canvas/workflow-error'
import { shotIdFor } from '@/features/director/audio-timing'
import type { ScriptUnit } from '@/features/director/schemas/ingest'
import type { AudioProjectSourcePayload } from '@/features/projects'
import {
  type PersistUserAudioArtifactsInput,
  type PersistedUserAudioArtifacts,
} from './user-audio-artifacts'
import {
  sliceDecodedUserRecording,
  type DecodedUserRecording,
} from './user-audio-slicer'
import {
  buildUserAudioTimeline,
  type UserAudioTimeline,
} from './user-audio-timeline'
import type { RoutedTranscribedSpeech } from './media-provider'
import { createAudioTranscriptionDependencies } from './audio-transcription-runtime'

const audioTranscriptionJobSchema = z
  .object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    billingContext: z
      .object({
        attemptId: z.string().min(1),
        invocationNo: z.number().int().min(1),
      })
      .strict(),
  })
  .strict()

const transcriptSchema = z.string().trim().min(1).max(200_000)

export type AudioTranscriptionJobInput = z.infer<typeof audioTranscriptionJobSchema>

export interface LoadedAudioProjectSource {
  source: AudioProjectSourcePayload
  sourceFingerprint: string
}

export type AudioTranscriptionState =
  | { status: 'running'; startedAt: string }
  | ({ status: 'waiting' } & WorkflowExecutionNotice)
  | {
      status: 'ready'
      ingestArtifactId: string
      audioArtifactId: string
      unitCount: number
      alignmentMode: UserAudioTimeline['alignmentMode']
      alignmentSource: RoutedTranscribedSpeech['alignmentSource']
      completedAt: string
    }
  | {
      status: 'failed'
      error: WorkflowErrorProjection
      completedAt: string
    }

export interface AudioTranscriptionDependencies {
  loadSource(projectId: string): Promise<LoadedAudioProjectSource>
  readSourceBytes(storageKey: string): Promise<Buffer>
  decode(sourceBytes: Buffer): Promise<DecodedUserRecording>
  transcribe(input: {
    audioBytes: Buffer
    audioFormat: 'mp3' | 'wav'
    audioSeconds: number
    billingContext: AudioTranscriptionJobInput['billingContext']
  }): Promise<RoutedTranscribedSpeech>
  persistArtifacts(
    input: PersistUserAudioArtifactsInput,
  ): Promise<PersistedUserAudioArtifacts>
  updateProjectScript(projectId: string, transcript: string): Promise<void>
  materialize(projectId: string, shots: readonly ShotLaneSeed[]): Promise<void>
  transition(nodeId: string, status: 'running' | 'success' | 'failed'): Promise<void>
  recordState(
    nodeId: string,
    state: AudioTranscriptionState,
    outputContentHash?: string,
  ): Promise<void>
  advance(projectId: string, nodeId: string): Promise<unknown>
  now(): Date
}

export class AudioSourceIntegrityError extends Error {
  readonly code = 'AUDIO_SOURCE_INTEGRITY_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'AudioSourceIntegrityError'
  }
}

/**
 * 录音工作流入口：原音频只解码一次，ASR 后直接复用 PCM 构造时间线与 WAV 切片。
 * 依赖合同刻意不包含 TTS/synthesize，避免录音路径误入二次配音。
 */
export async function runAudioTranscriptionJob(
  input: AudioTranscriptionJobInput,
  dependencies?: AudioTranscriptionDependencies,
): Promise<void> {
  const payload = audioTranscriptionJobSchema.parse(input)
  const resolved = dependencies ?? (await createAudioTranscriptionDependencies())
  await resolved.transition(payload.nodeId, 'running')

  try {
    await resolved.recordState(payload.nodeId, {
      status: 'running',
      startedAt: resolved.now().toISOString(),
    })
    const loaded = await resolved.loadSource(payload.projectId)
    const sourceBytes = await resolved.readSourceBytes(loaded.source.storageKey)
    verifySourceBytes(loaded, sourceBytes)

    const decoded = await resolved.decode(sourceBytes)
    verifyDecodedMetadata(loaded.source, decoded)
    const speech = await resolved.transcribe({
      audioBytes: sourceBytes,
      audioFormat: loaded.source.container,
      audioSeconds: decoded.measured.durationMs / 1_000,
      billingContext: payload.billingContext,
    })
    const transcript = transcriptSchema.parse(speech.transcript)
    const timeline = buildUserAudioTimeline({
      transcript,
      captions: speech.captions,
      measured: decoded.measured,
    })
    const slices = sliceDecodedUserRecording(decoded, timeline)
    const persisted = await resolved.persistArtifacts({
      projectId: payload.projectId,
      nodeId: payload.nodeId,
      attemptId: payload.billingContext.attemptId,
      source: loaded.source,
      sourceContentHash: loaded.sourceFingerprint,
      sourceBytes,
      timeline,
      slices,
    })

    await resolved.updateProjectScript(payload.projectId, transcript)
    await resolved.materialize(payload.projectId, shotSeeds(timeline))
    await resolved.recordState(
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
    )
    await resolved.transition(payload.nodeId, 'success')
  } catch (error) {
    if (error instanceof ProviderDispatchWaitError && error.retryAt) {
      await settleDispatchWait(payload.nodeId, error, error.retryAt, resolved)
    } else {
      await settleFailure(payload.nodeId, error, resolved)
    }
    throw error
  }

  await advanceWithoutMasking(resolved, payload.projectId, payload.nodeId)
}

export function verifySourceBytes(
  loaded: LoadedAudioProjectSource,
  sourceBytes: Buffer,
): void {
  if (
    sourceBytes.length !== loaded.source.sizeBytes ||
    sha256(sourceBytes) !== loaded.sourceFingerprint
  ) {
    throw new AudioSourceIntegrityError('录音源文件与创建项目时登记的字节证据不一致')
  }
}

export function verifyDecodedMetadata(
  source: AudioProjectSourcePayload,
  decoded: DecodedUserRecording,
): void {
  const measured = decoded.measured
  if (
    measured.container !== source.container ||
    measured.sampleRateHz !== source.sampleRate ||
    measured.sampleCount !== source.sampleCount ||
    Math.round(measured.durationMs) !== source.durationMs
  ) {
    throw new AudioSourceIntegrityError('录音源文件的实测媒体元数据与项目来源记录不一致')
  }
}

function shotSeeds(timeline: UserAudioTimeline): ShotLaneSeed[] {
  return timeline.scriptUnits.map((unit, index) => ({
    shotId: shotIdFor(index),
    sourceUnit: unit satisfies ScriptUnit,
  }))
}

async function settleDispatchWait(
  nodeId: string,
  error: ProviderDispatchWaitError,
  retryAt: string,
  dependencies: AudioTranscriptionDependencies,
): Promise<void> {
  const cleanupErrors: unknown[] = []
  try {
    await dependencies.recordState(nodeId, {
      status: 'waiting',
      code: 'PROVIDER_POOL_WAIT',
      message: `${error.providerLabel}正在等待可用调用窗口`,
      resumeAt: retryAt,
      providerLabel: error.providerLabel,
    })
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
): Promise<void> {
  const cleanupErrors: unknown[] = []
  const projection = classifyWorkflowError(error, {
    stage: 'INGEST',
    sourceNodeId: nodeId,
  })
  try {
    await dependencies.recordState(nodeId, {
      status: 'failed',
      error: projection,
      completedAt: dependencies.now().toISOString(),
    })
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError)
  }
  try {
    await dependencies.transition(nodeId, 'failed')
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
): Promise<void> {
  try {
    await dependencies.advance(projectId, nodeId)
  } catch (error) {
    console.error('[audio-transcription] 下游自动推进失败', {
      projectId,
      nodeId,
      errorName: error instanceof Error ? error.name : 'NonErrorThrown',
    })
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
