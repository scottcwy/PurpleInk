import 'server-only'
import { createHash } from 'node:crypto'
import type { ArtifactPointerInput } from '@/features/director/runtime-artifact-writer'
import type {
  AudioAllocation,
  AudioManifest,
  ScriptUnit,
} from '@/features/director/schemas/ingest'
import type { AudioProjectSourcePayload } from '@/features/projects'
import type { StorageAdapter } from '@/lib/storage'
import type { UserAudioTimeline } from './user-audio-timeline'
import type { UserRecordingAudioSlice } from './user-audio-slicer'
import { narrationArtifactKind } from './narration-repository'
import {
  buildUserAudioContracts,
  type StoredUserAudioSlice,
} from './user-audio-manifest'

export const USER_AUDIO_ARTIFACT_KINDS = {
  source: 'user-audio-source',
  cut: 'user-audio-cut',
  ingest: 'director-ingest',
  ingestAudio: 'director-ingest-audio',
} as const

export interface AudioArtifactPointerWriter {
  registerPointer(input: ArtifactPointerInput): Promise<string>
}

export interface PersistUserAudioArtifactsInput {
  projectId: string
  nodeId: string
  attemptId: string
  source: AudioProjectSourcePayload
  sourceContentHash: string
  sourceBytes: Buffer
  timeline: UserAudioTimeline
  slices: readonly UserRecordingAudioSlice[]
}

export interface PersistedUserAudioArtifacts {
  sourceArtifactId: string
  cutArtifactIds: string[]
  ingestArtifactId: string
  ingestAudioArtifactId: string
  ingestContentHash: string
  audioContentHash: string
  audioManifest: AudioManifest
  audioAllocation: AudioAllocation
}

export interface UserAudioArtifactDependencies {
  storage: StorageAdapter
  writer: AudioArtifactPointerWriter
}

/**
 * 只登记已经完整生成的不可变字节。attempt 摘要进入路径，重试不会覆盖前一次
 * 已登记产物；JSON 合同最后写入，避免消费者读到半成品。
 */
export async function persistUserAudioArtifacts(
  input: PersistUserAudioArtifactsInput,
  dependencies: UserAudioArtifactDependencies,
): Promise<PersistedUserAudioArtifacts> {
  const base = artifactBase(input)
  const source = await writePointer(
    dependencies,
    input,
    `${base}/source.${input.source.container}`,
    input.sourceBytes,
    USER_AUDIO_ARTIFACT_KINDS.source,
    input.sourceContentHash,
  )

  const storedSlices: StoredUserAudioSlice[] = []
  const cutArtifactIds: string[] = []
  for (const slice of input.slices) {
    const key = `${base}/cuts/${slice.unitId}-${slice.contentHash}.wav`
    const cut = await writePointer(
      dependencies,
      input,
      key,
      slice.audioBytes,
      USER_AUDIO_ARTIFACT_KINDS.cut,
      slice.contentHash,
    )
    await dependencies.writer.registerPointer({
      projectId: input.projectId,
      nodeId: input.nodeId,
      kind: narrationArtifactKind(slice.unitId),
      storageKey: cut.storageKey,
      contentHash: cut.contentHash,
    })
    storedSlices.push({ storageKey: cut.storageKey, slice })
    cutArtifactIds.push(cut.artifactId)
  }

  const scriptUnits = input.timeline.scriptUnits as ScriptUnit[]
  const contracts = buildUserAudioContracts({
    scriptUnits,
    sourceStorageKey: source.storageKey,
    sourceContentHash: input.sourceContentHash,
    slices: storedSlices,
  })
  const ingest = await writeJsonPointer(
    dependencies,
    input,
    `${base}/director-ingest.json`,
    USER_AUDIO_ARTIFACT_KINDS.ingest,
    { scriptUnits },
  )
  const ingestAudio = await writeJsonPointer(
    dependencies,
    input,
    `${base}/director-ingest-audio.json`,
    USER_AUDIO_ARTIFACT_KINDS.ingestAudio,
    contracts,
  )

  return {
    sourceArtifactId: source.artifactId,
    cutArtifactIds,
    ingestArtifactId: ingest.artifactId,
    ingestAudioArtifactId: ingestAudio.artifactId,
    ingestContentHash: ingest.contentHash,
    audioContentHash: ingestAudio.contentHash,
    ...contracts,
  }
}

function artifactBase(input: PersistUserAudioArtifactsInput): string {
  const attempt = sha256(input.attemptId).slice(0, 20)
  return `director/${input.projectId}/${input.nodeId}/audio-transcription/${attempt}`
}

async function writeJsonPointer(
  dependencies: UserAudioArtifactDependencies,
  aggregate: Pick<PersistUserAudioArtifactsInput, 'projectId' | 'nodeId'>,
  storageKey: string,
  kind: string,
  value: unknown,
): Promise<StoredPointer> {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8')
  return writePointer(
    dependencies,
    aggregate,
    storageKey,
    bytes,
    kind,
    sha256(bytes),
  )
}

interface StoredPointer {
  artifactId: string
  storageKey: string
  contentHash: string
}

async function writePointer(
  dependencies: UserAudioArtifactDependencies,
  aggregate: Pick<PersistUserAudioArtifactsInput, 'projectId' | 'nodeId'>,
  requestedKey: string,
  bytes: Buffer,
  kind: string,
  expectedHash: string,
): Promise<StoredPointer> {
  const contentHash = sha256(bytes)
  if (contentHash !== expectedHash) {
    throw new Error('待登记录音产物的最终字节哈希不一致')
  }
  const storageKey = await dependencies.storage.put(requestedKey, bytes)
  const artifactId = await dependencies.writer.registerPointer({
    projectId: aggregate.projectId,
    nodeId: aggregate.nodeId,
    kind,
    storageKey,
    contentHash,
  })
  return { artifactId, storageKey, contentHash }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
