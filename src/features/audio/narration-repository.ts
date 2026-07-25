import 'server-only'
import { createHash } from 'node:crypto'
import {
  commitArtifactRecord,
  resolveCurrentAttemptId,
} from '@/features/artifacts'
import { getDb, LOCAL_WORKSPACE_ID, type Db } from '@/lib/db/client'
import { storage as defaultStorage, type StorageAdapter } from '@/lib/storage'

export interface NarrationAudioRecord {
  audioArtifactId: string
  audioKey: string
  version: number
}

export interface RegisterNarrationAudioInput {
  projectId: string
  nodeId: string
  unitId: string
  audioKey: string
  bytes: Buffer
  contentHash: string
}

interface NarrationRepositoryDependencies {
  db?: Db
  storage?: StorageAdapter
}

/**
 * 每个 script unit 一个独立 artifact kind。
 *
 * artifacts 的版本链按 (aggregate, kind) 递增，若 N 段旁白共用一个 kind，
 * 它们会互相 supersede，被误记为同一产物的多个版本。
 */
export function narrationArtifactKind(unitId: string): string {
  return `narration-audio:${unitId}`
}

/** 命中已落盘的同输入音频字节；未命中返回 null，由调用方真实合成。 */
export async function reuseNarrationAudio(
  audioKey: string,
  dependencies: NarrationRepositoryDependencies = {}
): Promise<Buffer | null> {
  const storage = dependencies.storage ?? defaultStorage
  if (!(await storage.exists(audioKey))) return null
  const bytes = await storage.get(audioKey)
  return bytes.length > 0 ? bytes : null
}

/**
 * 落盘真实音频字节并原子登记不可变索引。
 *
 * storageKey 是输入内容寻址的，重复写入同一键即同一字节；
 * 落盘后必须复核实际字节的 SHA-256 与声明一致，声明值不被信任。
 */
export async function registerNarrationAudio(
  input: RegisterNarrationAudioInput,
  dependencies: NarrationRepositoryDependencies = {}
): Promise<NarrationAudioRecord> {
  const storage = dependencies.storage ?? defaultStorage
  const database = dependencies.db ?? (await getDb())
  await storage.put(input.audioKey, input.bytes)
  const stored = await storage.get(input.audioKey)
  const actualHash = createHash('sha256').update(stored).digest('hex')
  if (actualHash !== input.contentHash) {
    throw new Error(`旁白音频实体 hash 与声明不一致：${input.audioKey}`)
  }
  const attemptId = await resolveCurrentAttemptId(database, {
    workspaceId: LOCAL_WORKSPACE_ID,
    projectId: input.projectId,
    aggregateType: 'node',
    aggregateId: input.nodeId,
  })
  const committed = await commitArtifactRecord(database, {
    workspaceId: LOCAL_WORKSPACE_ID,
    projectId: input.projectId,
    aggregateType: 'node',
    aggregateId: input.nodeId,
    kind: narrationArtifactKind(input.unitId),
    schemaVersion: 'cvc.narration-audio/v1',
    storageKey: input.audioKey,
    sizeBytes: stored.byteLength,
    contentHash: actualHash,
    attemptId,
  })
  return {
    audioArtifactId: committed.artifactId,
    audioKey: input.audioKey,
    version: committed.version,
  }
}
