import { createHash, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectorArtifactWriter } from '@/features/director/runtime-artifact-writer'
import { loadMediaAssembly } from '@/features/render/media-assembly-loader'
import { type Db } from '@/lib/db/client'
import {
  artifacts,
  canvasNodes,
  pipelineRuns,
  projects,
  taskAttempts,
  workspaces,
} from '@/lib/db/schema/index'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import type { StorageAdapter } from '@/lib/storage'
import { AudioRuntimeRepository } from './runtime-repository'
import { persistUserAudioArtifacts } from './user-audio-artifacts'
import { sliceDecodedUserRecording } from './user-audio-slicer'
import { buildUserAudioTimeline } from './user-audio-timeline'

vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => WORKSPACE_ID,
  currentUserId: () => 'test-user',
}))
vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const SOURCE_BYTES = Buffer.from('用户录音来源')
const SOURCE_HASH = digest(SOURCE_BYTES)
const SAMPLE_RATE = 8_000
const SAMPLE_COUNT = 8_000

let database: PgTestDatabase

beforeAll(async () => {
  database = await createPgTestDatabase()
})

beforeEach(async () => {
  await database.reset()
})

afterAll(async () => {
  await database.close()
})

describe('user audio Artifact seam', () => {
  it('persists one real cut that both Director and render consume through narration Artifact', async () => {
    const seam = await seedSeam(database.db)
    const rows = await database.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.projectId, seam.projectId))
    const cut = rows.find((row) => row.kind === 'user-audio-cut')
    const narration = rows.find((row) => row.kind === 'narration-audio:U001')

    expect(narration).toMatchObject({
      storageKey: cut?.storageKey,
      contentHash: cut?.contentHash,
      sizeBytes: cut?.sizeBytes,
      attemptId: seam.audioAttemptId,
    })
    expect(seam.persisted.audioManifest.units[0]).toMatchObject({
      unitId: 'U001',
      source: 'user',
      audioFile: cut?.storageKey,
      alignment: {
        sourceStartSample: 0,
        sourceEndSample: SAMPLE_COUNT,
      },
    })

    const loaded = await new AudioRuntimeRepository(
      database.db,
      seam.storage,
    ).loadNarration(seam.projectId, 'U001')
    expect(loaded.audioBytes).toEqual(seam.sliceBytes)

    const assembly = await loadAssembly(database.db, seam)
    expect(assembly.blockingIssues).toEqual([])
    expect(assembly.plan?.shots[0]?.narration.artifact).toMatchObject({
      artifactId: narration?.id,
      storageKey: cut?.storageKey,
      contentHash: cut?.contentHash,
    })
  })

  it('fails closed when only the diagnostic cut exists', async () => {
    const seam = await seedSeam(database.db)
    await database.db
      .delete(artifacts)
      .where(
        and(
          eq(artifacts.projectId, seam.projectId),
          eq(artifacts.kind, 'narration-audio:U001'),
        ),
      )

    await expect(
      new AudioRuntimeRepository(database.db, seam.storage).loadNarration(
        seam.projectId,
        'U001',
      ),
    ).rejects.toThrow('narration-audio:U001')
    await expect(loadAssembly(database.db, seam)).resolves.toMatchObject({
      plan: null,
      blockingIssues: [
        { laneKey: 'S001', kind: 'narration', code: 'artifact-missing' },
      ],
    })
  })

  it('fails closed when narration storage bytes or indexed size drift', async () => {
    const seam = await seedSeam(database.db)
    const [narration] = await database.db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.projectId, seam.projectId),
          eq(artifacts.kind, 'narration-audio:U001'),
        ),
      )
    const tampered = Buffer.from(seam.sliceBytes)
    tampered[tampered.byteLength - 1] ^= 1
    seam.memory.set(narration!.storageKey, tampered)

    await expect(
      new AudioRuntimeRepository(database.db, seam.storage).loadNarration(
        seam.projectId,
        'U001',
      ),
    ).rejects.toThrow('hash 不一致')
    expect((await loadAssembly(database.db, seam)).blockingIssues).toContainEqual({
      laneKey: 'S001',
      kind: 'narration',
      code: 'artifact-invalid',
    })

    seam.memory.set(narration!.storageKey, seam.sliceBytes)
    await database.db
      .update(artifacts)
      .set({ sizeBytes: seam.sliceBytes.byteLength + 1 })
      .where(eq(artifacts.id, narration!.id))
    expect((await loadAssembly(database.db, seam)).blockingIssues).toContainEqual({
      laneKey: 'S001',
      kind: 'narration',
      code: 'artifact-invalid',
    })
  })
})

async function seedSeam(db: Db) {
  const projectId = randomUUID()
  const audioNodeId = randomUUID()
  const codegenNodeId = randomUUID()
  const audioAttemptId = randomUUID()
  const renderAttemptId = randomUUID()
  const memory = new Map<string, Buffer>()
  const storage = memoryStorage(memory)
  await db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'audio-seam',
    name: 'Audio Seam',
  })
  await db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: projectId,
    title: '录音项目',
    script: '原声旁白',
    workflowKind: 'audio',
    workflowVersion: 'purpleink-audio-to-video-v1',
    exportSettings: { schemaVersion: 1 },
  })
  await db.insert(canvasNodes).values([
    {
      workspaceId: WORKSPACE_ID,
      id: audioNodeId,
      projectId,
      logicalKey: 'global:audio-transcribe',
      type: 'audio-transcribe',
      stage: 'INGEST',
      status: 'succeeded',
      data: { schemaVersion: 1, payload: {} },
    },
    {
      workspaceId: WORKSPACE_ID,
      id: codegenNodeId,
      projectId,
      logicalKey: 'shot:S001:shot-codegen',
      type: 'shot-codegen',
      stage: 'FABRICATE',
      status: 'succeeded',
      data: { schemaVersion: 1, payload: { laneKey: 'S001' } },
    },
  ])
  await seedAttempt(db, projectId, audioNodeId, audioAttemptId, 1)
  await seedAttempt(db, projectId, codegenNodeId, renderAttemptId, 2)

  const measured = {
    sampleRateHz: SAMPLE_RATE,
    sampleCount: SAMPLE_COUNT,
    durationMs: 1_000,
    container: 'wav' as const,
  }
  const timeline = buildUserAudioTimeline({
    transcript: '原声旁白',
    captions: [],
    measured,
  })
  const slices = sliceDecodedUserRecording(
    { measured, pcmBytes: Buffer.alloc(SAMPLE_COUNT * 2, 7) },
    timeline,
  )
  const persisted = await persistUserAudioArtifacts(
    {
      projectId,
      nodeId: audioNodeId,
      attemptId: audioAttemptId,
      source: {
        schemaVersion: 1,
        kind: 'audio',
        storageKey: 'sources/user.wav',
        fileName: '用户录音.wav',
        mimeType: 'audio/wav',
        container: 'wav',
        sizeBytes: SOURCE_BYTES.byteLength,
        durationMs: 1_000,
        sampleRate: SAMPLE_RATE,
        sampleCount: SAMPLE_COUNT,
        visualTheme: 'dark',
      },
      sourceContentHash: SOURCE_HASH,
      sourceBytes: SOURCE_BYTES,
      timeline,
      slices,
    },
    { storage, writer: new DirectorArtifactWriter(db, storage) },
  )
  const renderBytes = Buffer.from('rendered video')
  const renderKey = `render/${projectId}/S001.mp4`
  await storage.put(renderKey, renderBytes)
  await db.insert(artifacts).values({
    workspaceId: WORKSPACE_ID,
    projectId,
    aggregateType: 'node',
    aggregateId: codegenNodeId,
    kind: 'render-mp4',
    version: 1,
    schemaVersion: 'cvc.render/v1',
    storageKey: renderKey,
    sizeBytes: renderBytes.byteLength,
    contentHash: digest(renderBytes),
    attemptId: renderAttemptId,
  })
  return {
    projectId,
    audioNodeId,
    codegenNodeId,
    audioAttemptId,
    memory,
    storage,
    persisted,
    sliceBytes: slices[0]!.audioBytes,
  }
}

async function seedAttempt(
  db: Db,
  projectId: string,
  nodeId: string,
  attemptId: string,
  attemptNo: number,
): Promise<void> {
  const runId = randomUUID()
  await db.insert(pipelineRuns).values({
    workspaceId: WORKSPACE_ID,
    id: runId,
    projectId,
    status: 'running',
    workflowVersion: 'purpleink-audio-to-video-v1',
    fingerprint: String(attemptNo).repeat(64),
  })
  await db.insert(taskAttempts).values({
    workspaceId: WORKSPACE_ID,
    id: attemptId,
    runId,
    taskId: `audio-seam-${attemptNo}`,
    entityType: 'node',
    entityId: nodeId,
    attemptNo: 1,
    status: 'running',
    fingerprint: String(attemptNo).repeat(64),
    checkpoint: { schemaVersion: 1 },
  })
}

async function loadAssembly(
  db: Db,
  seam: Awaited<ReturnType<typeof seedSeam>>,
) {
  return loadMediaAssembly({
    database: db,
    storage: seam.storage,
    projectId: seam.projectId,
    nodes: [
      {
        nodeId: seam.audioNodeId,
        type: 'audio-transcribe',
        status: 'succeeded',
        laneKey: null,
      },
      {
        nodeId: seam.codegenNodeId,
        type: 'shot-codegen',
        status: 'succeeded',
        laneKey: 'S001',
      },
    ],
    targetResolution: { width: 1280, height: 720 },
    musicKey: null,
    subtitles: 'off',
  })
}

function memoryStorage(memory: Map<string, Buffer>): StorageAdapter {
  return {
    put: async (key, data) => {
      memory.set(key, Buffer.from(data))
      return key
    },
    get: async (key) => {
      const bytes = memory.get(key)
      if (!bytes) throw new Error(`missing test artifact: ${key}`)
      return Buffer.from(bytes)
    },
    exists: async (key) => memory.has(key),
    localPath: (key) => key,
    delete: async (key) => {
      memory.delete(key)
    },
    tempDir: async () => 'test-temp',
    readLocalFile: async () => Buffer.alloc(0),
    removeTempDir: async () => {},
  }
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
