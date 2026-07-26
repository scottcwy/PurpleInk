import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { classifyWorkflowError, type WorkflowErrorProjection } from '@/features/canvas/workflow-error'
import { advancePipeline } from '@/features/director/advance'
import {
  buildMeasuredAudioAllocation,
  buildMeasuredAudioManifest,
} from '@/features/director/audio-timing'
import { DirectorArtifactSource } from '@/features/director/runtime-artifact-source'
import { DirectorArtifactWriter } from '@/features/director/runtime-artifact-writer'
import { patchNodePayload } from '@/features/director/runtime-node-data'
import type {
  AudioAllocation,
  AudioManifest,
  ScriptUnit,
} from '@/features/director/schemas/ingest'
import { getDb, LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import { canvasNodes } from '@/lib/db/schema/index'
import { queue as defaultQueue, type QueueAdapter } from '@/lib/queue'
import { storage } from '@/lib/storage'
import { synthesizeNarration, type NarrationResult } from './narration'

const mediaNarrationJobSchema = z
  .object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
  })
  .strict()

export type MediaNarrationJobInput = z.infer<typeof mediaNarrationJobSchema>

interface PersistMediaResultInput extends MediaNarrationJobInput {
  audioManifest: AudioManifest
  audioAllocation: AudioAllocation
}

type MediaState =
  | { status: 'running'; startedAt: string }
  | { status: 'ready'; artifactId: string; completedAt: string }
  | { status: 'failed'; error: WorkflowErrorProjection; completedAt: string }

export interface MediaNarrationDependencies {
  loadScriptUnits(projectId: string): Promise<ScriptUnit[]>
  synthesize(input: {
    projectId: string
    nodeId: string
    units: Array<{ unitId: string; text: string }>
  }): Promise<NarrationResult>
  persistResult(input: PersistMediaResultInput): Promise<string>
  updateMediaState(nodeId: string, state: MediaState): Promise<void>
  listWakeNodeIds(projectId: string): Promise<string[]>
  advance(projectId: string, nodeId: string): Promise<unknown>
}

export async function runMediaNarrationJob(
  input: MediaNarrationJobInput,
  dependencies?: MediaNarrationDependencies
): Promise<void> {
  const payload = mediaNarrationJobSchema.parse(input)
  const resolved = dependencies ?? (await createDefaultDependencies())
  await resolved.updateMediaState(payload.nodeId, {
    status: 'running',
    startedAt: new Date().toISOString(),
  })
  try {
    const scriptUnits = await resolved.loadScriptUnits(payload.projectId)
    const narration = await resolved.synthesize({
      ...payload,
      units: scriptUnits.map(({ unitId, text }) => ({ unitId, text })),
    })
    const audioManifest = buildMeasuredAudioManifest(scriptUnits, narration)
    const audioAllocation = buildMeasuredAudioAllocation(scriptUnits, audioManifest)
    const artifactId = await resolved.persistResult({
      ...payload,
      audioManifest,
      audioAllocation,
    })
    await resolved.updateMediaState(payload.nodeId, {
      status: 'ready',
      artifactId,
      completedAt: new Date().toISOString(),
    })
    for (const nodeId of await resolved.listWakeNodeIds(payload.projectId)) {
      await resolved.advance(payload.projectId, nodeId)
    }
  } catch (error) {
    await resolved.updateMediaState(payload.nodeId, {
      status: 'failed',
      error: classifyWorkflowError(error, {
        stage: 'MEDIA_NARRATION',
        sourceNodeId: payload.nodeId,
      }),
      completedAt: new Date().toISOString(),
    })
    throw error
  }
}

export function registerMediaNarrationHandler(
  targetQueue: QueueAdapter = defaultQueue,
  run: typeof runMediaNarrationJob = runMediaNarrationJob
): void {
  targetQueue.register('media-narration', async (job) => {
    await run(mediaNarrationJobSchema.parse(job.payload))
  })
}

export async function enqueueMediaNarration(
  input: MediaNarrationJobInput,
  targetQueue: QueueAdapter = defaultQueue
): Promise<string> {
  const payload = mediaNarrationJobSchema.parse(input)
  return targetQueue.enqueue('media-narration', payload, {
    projectId: payload.projectId,
    nodeId: payload.nodeId,
  })
}

async function createDefaultDependencies(): Promise<MediaNarrationDependencies> {
  const database = await getDb()
  const source = new DirectorArtifactSource(database, storage)
  const writer = new DirectorArtifactWriter(database, storage)
  return {
    loadScriptUnits: async (projectId) =>
      (await source.loadIngestArtifact(projectId)).scriptUnits,
    synthesize: synthesizeNarration,
    persistResult: async (input) => {
      const content = JSON.stringify({
        audioManifest: input.audioManifest,
        audioAllocation: input.audioAllocation,
      })
      const hash = createHash('sha256').update(content).digest('hex')
      const storageKey = `director/${input.projectId}/${input.nodeId}/ingest-audio/${hash}.json`
      await storage.put(storageKey, content)
      return writer.registerPointer({
        projectId: input.projectId,
        nodeId: input.nodeId,
        kind: 'director-ingest-audio',
        storageKey,
        contentHash: hash,
      })
    },
    updateMediaState: async (nodeId, state) => {
      await patchMediaState(nodeId, state)
    },
    listWakeNodeIds: async (projectId) => {
      const rows = await database
        .select({ id: canvasNodes.id })
        .from(canvasNodes)
        .where(
          and(
            eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
            eq(canvasNodes.projectId, projectId),
            eq(canvasNodes.type, 'shot-script'),
            eq(canvasNodes.status, 'succeeded')
          )
        )
      return rows.map(({ id }) => id)
    },
    advance: advancePipeline,
  }
}

async function patchMediaState(nodeId: string, state: MediaState): Promise<void> {
  const database = await getDb()
  await database.transaction(async (transaction) => {
    const [node] = await transaction
      .select({ data: canvasNodes.data })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
          eq(canvasNodes.id, nodeId)
        )
      )
      .limit(1)
      .for('update')
    if (!node) throw new Error(`节点不存在：${nodeId}`)
    await transaction
      .update(canvasNodes)
      .set({
        data: patchNodePayload(node.data, { mediaNarration: state }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
          eq(canvasNodes.id, nodeId)
        )
      )
  })
}
