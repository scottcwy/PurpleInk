import 'server-only'
import { createHash } from 'node:crypto'
import type { CommitArtifactInput } from '@/features/artifacts'
import type { StorageAdapter } from '@/lib/storage'
import type { WebsiteEngineJob } from './engine-client'
import { storeProceduralSfxManifest } from '@/features/render/procedural-sfx-manifest'
import { WebsiteExecutionError } from './website-engine-execution'
import {
  websiteVerificationProjection,
  type WebsiteOutputProjection,
} from './website-stage-contract'

const MAX_WEBSITE_VIDEO_BYTES = 1_073_741_824

export interface WebsiteOutputInput {
  workspaceId: string
  projectId: string
  attemptId: string
  job: WebsiteEngineJob
  videoBytes: Buffer
}

export interface PersistedWebsiteOutput extends WebsiteOutputProjection {
  storageKey: string
  soundEffectsManifestArtifactId: string
}

export interface WebsiteOutputDependencies {
  storage: Pick<StorageAdapter, 'put' | 'delete'>
  commitArtifacts(
    inputs: readonly CommitArtifactInput[],
  ): Promise<Array<{ artifactId: string; version: number }>>
}

export async function persistWebsiteVideoOutput(
  input: WebsiteOutputInput,
  dependencies: WebsiteOutputDependencies,
): Promise<PersistedWebsiteOutput> {
  assertMp4Bytes(input.videoBytes)
  const verification = requireVerification(input.job)
  const soundEffects = requireSoundEffects(input.job)
  const contentHash = createHash('sha256').update(input.videoBytes).digest('hex')
  const requestedKey = [
    'website',
    input.projectId,
    input.attemptId,
    `${contentHash}.mp4`,
  ].join('/')
  let storageKey: string | null = null
  let soundEffectsManifest: Awaited<
    ReturnType<typeof storeProceduralSfxManifest>
  > | null = null
  try {
    storageKey = await dependencies.storage.put(requestedKey, input.videoBytes)
    soundEffectsManifest = await storeProceduralSfxManifest(
      dependencies.storage,
      {
        projectId: input.projectId,
        attemptId: input.attemptId,
        finalContentHash: contentHash,
        soundEffects,
      },
    )
    const committed = await dependencies.commitArtifacts([
      {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        aggregateType: 'project',
        aggregateId: input.projectId,
        kind: 'website-video-mp4',
        schemaVersion: '1',
        storageKey,
        sizeBytes: input.videoBytes.byteLength,
        contentHash,
        attemptId: input.attemptId,
      },
      {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        aggregateType: 'project',
        aggregateId: input.projectId,
        kind: 'procedural-sfx-manifest',
        schemaVersion: 'cvc.procedural-sfx-manifest/v1',
        ...soundEffectsManifest,
        attemptId: input.attemptId,
      },
    ])
    const videoArtifact = committed[0]
    const soundEffectsArtifact = committed[1]
    if (!videoArtifact || !soundEffectsArtifact) {
      throw new Error('网站终片 Artifact 批量提交不完整')
    }
    return {
      artifactId: videoArtifact.artifactId,
      storageKey,
      soundEffectsManifestArtifactId: soundEffectsArtifact.artifactId,
      contentHash,
      sizeBytes: input.videoBytes.byteLength,
      durationSec: input.job.durationSec,
      durationSource: input.job.durationSource,
      elapsedSec: input.job.elapsedSec,
      verification,
    }
  } catch (error) {
    await removeUncommittedOutputs(
      [
        storageKey,
        soundEffectsManifest?.storageKey ?? null,
      ],
      error,
      dependencies.storage,
    )
    throw error
  }
}

function requireVerification(
  job: WebsiteEngineJob,
): WebsiteOutputProjection['verification'] {
  const verification = websiteVerificationProjection(job)
  if (!verification) {
    throw new WebsiteExecutionError('WEBSITE_ENGINE_RESPONSE_INVALID')
  }
  return verification
}

function requireSoundEffects(
  job: WebsiteEngineJob,
): NonNullable<WebsiteEngineJob['soundEffects']> {
  if (!job.soundEffects) {
    throw new WebsiteExecutionError('WEBSITE_ENGINE_RESPONSE_INVALID')
  }
  return job.soundEffects
}

export function assertMp4Bytes(bytes: Buffer): void {
  if (
    bytes.byteLength < 72
    || bytes.byteLength > MAX_WEBSITE_VIDEO_BYTES
    || !hasRequiredMp4Boxes(bytes)
  ) {
    throw new WebsiteExecutionError('WEBSITE_VIDEO_INVALID')
  }
}

function hasRequiredMp4Boxes(bytes: Buffer): boolean {
  let offset = 0
  let hasFtyp = false
  let hasMoov = false
  let hasMdat = false
  while (offset + 8 <= bytes.byteLength) {
    const size32 = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const headerSize = size32 === 1 ? 16 : 8
    if (offset + headerSize > bytes.byteLength) return false
    const size = readBoxSize(bytes, offset, size32)
    if (size < headerSize || offset + size > bytes.byteLength) return false
    const payloadSize = size - headerSize
    if (type === 'ftyp') hasFtyp = payloadSize >= 8
    if (type === 'moov') {
      hasMoov = hasValidMovieHeader(bytes, offset + headerSize, offset + size)
    }
    if (type === 'mdat') hasMdat = payloadSize >= 4
    offset += size
  }
  return offset === bytes.byteLength && hasFtyp && hasMoov && hasMdat
}

function hasValidMovieHeader(bytes: Buffer, start: number, end: number): boolean {
  let offset = start
  let hasMvhd = false
  while (offset + 8 <= end) {
    const size32 = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const headerSize = size32 === 1 ? 16 : 8
    if (offset + headerSize > end) return false
    const size = readBoxSize(bytes, offset, size32)
    if (size < headerSize || offset + size > end) return false
    if (type === 'mvhd') {
      const payloadSize = size - headerSize
      const version = bytes[offset + headerSize]
      hasMvhd = version === 0 ? payloadSize >= 100 : version === 1 && payloadSize >= 112
    }
    offset += size
  }
  return offset === end && hasMvhd
}

function readBoxSize(bytes: Buffer, offset: number, size32: number): number {
  if (size32 === 0) return bytes.byteLength - offset
  if (size32 !== 1) return size32
  const extended = bytes.readBigUInt64BE(offset + 8)
  if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER
  return Number(extended)
}

async function removeUncommittedOutputs(
  storageKeys: readonly (string | null)[],
  originalError: unknown,
  target: Pick<StorageAdapter, 'delete'>,
): Promise<void> {
  const cleanupErrors: unknown[] = []
  for (const storageKey of storageKeys) {
    if (!storageKey) continue
    try {
      await target.delete(storageKey)
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [originalError, ...cleanupErrors],
      '网站视频 Artifact 提交失败且临时输出清理失败',
    )
  }
}
