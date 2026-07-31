import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ShotLaneSeed } from '@/features/canvas'
import type {
  WorkflowErrorProjection,
  WorkflowExecutionNotice,
} from '@/features/canvas/workflow-error'
import type { AudioProjectSourcePayload } from '@/features/projects'
import type { NodeExecutionFence } from '@/lib/db/transaction'
import type { RoutedTranscribedSpeech } from './media-provider'
import type {
  PersistUserAudioArtifactsInput,
  PersistUserAudioSourceArtifactInput,
  PersistedUserAudioArtifacts,
  PersistedUserAudioSourceArtifact,
} from './user-audio-artifacts'
import type { DecodedUserRecording } from './user-audio-slicer'
import type { UserAudioTimeline } from './user-audio-timeline'

export const audioTranscriptionJobSchema = z
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

export const transcriptSchema = z.string().trim().min(1).max(200_000)

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
    signal?: AbortSignal
  }): Promise<RoutedTranscribedSpeech>
  persistSource(
    input: PersistUserAudioSourceArtifactInput,
  ): Promise<PersistedUserAudioSourceArtifact>
  persistArtifacts(
    input: PersistUserAudioArtifactsInput,
  ): Promise<PersistedUserAudioArtifacts>
  assertActive(nodeId: string, execution: NodeExecutionFence): Promise<void>
  updateProjectScript(
    projectId: string,
    transcript: string,
    execution?: NodeExecutionFence,
  ): Promise<void>
  materialize(
    projectId: string,
    shots: readonly ShotLaneSeed[],
    execution?: NodeExecutionFence,
  ): Promise<void>
  activateContinuation(
    projectId: string,
    nodeId: string,
    execution?: NodeExecutionFence,
  ): Promise<void>
  transition(
    nodeId: string,
    status: 'running' | 'success' | 'failed',
    execution?: NodeExecutionFence,
  ): Promise<void>
  recordState(
    nodeId: string,
    state: AudioTranscriptionState,
    outputContentHash?: string,
    execution?: NodeExecutionFence,
  ): Promise<void>
  advance(
    projectId: string,
    nodeId: string,
    execution?: NodeExecutionFence,
  ): Promise<unknown>
  now(): Promise<Date>
}

export interface AudioTranscriptionExecution {
  attemptId: string
  signal?: AbortSignal
}

export class AudioSourceIntegrityError extends Error {
  readonly code = 'AUDIO_SOURCE_INTEGRITY_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'AudioSourceIntegrityError'
  }
}

export function verifySourceBytes(
  loaded: LoadedAudioProjectSource,
  sourceBytes: Buffer,
): void {
  if (
    sourceBytes.length !== loaded.source.sizeBytes ||
    createHash('sha256').update(sourceBytes).digest('hex') !== loaded.sourceFingerprint
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
