import 'server-only'
import { billingInvocationNo } from '@/features/billing'
import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ProviderQueueDeferral } from '@/features/ai/provider-queue-deferral'
import {
  classifyWorkflowError,
  type WorkflowErrorProjection,
  type WorkflowExecutionNotice,
} from '@/features/canvas/workflow-error'
import { isManagedProvider } from '@/features/ai'
import { assertBillingAvailable } from '@/features/billing'
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
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import { readDatabaseClock } from '@/lib/db/database-clock'
import { canvasNodes } from '@/lib/db/schema/index'
import { queue as defaultQueue, type QueueAdapter } from '@/lib/queue'
import { storage } from '@/lib/storage'
import { synthesizeNarration, type NarrationResult } from './narration'
import { describeMediaProvider } from './media-provider'

const mediaNarrationJobSchema = z
  .object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    billingContext: z.object({
      attemptId: z.string().min(1),
      invocationNo: z.number().int().min(1),
    }).strict().optional(),
  })
  .strict()

export type MediaNarrationJobInput = z.infer<typeof mediaNarrationJobSchema>

interface PersistMediaResultInput extends MediaNarrationJobInput {
  audioManifest: AudioManifest
  audioAllocation: AudioAllocation
}

type MediaState =
  | { status: 'running'; startedAt: string }
  | ({ status: 'waiting' } & WorkflowExecutionNotice)
  | { status: 'ready'; artifactId: string; completedAt: string }
  | { status: 'failed'; error: WorkflowErrorProjection; completedAt: string }

export interface MediaNarrationDependencies {
  now(): Promise<Date>
  loadScriptUnits(projectId: string): Promise<ScriptUnit[]>
  synthesize(input: {
    projectId: string
    nodeId: string
    units: Array<{ unitId: string; text: string }>
    billingContext?: {
      attemptId: string
      invocationNo: number
    }
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
  const startedAt = await resolved.now()
  await resolved.updateMediaState(payload.nodeId, {
    status: 'running',
    startedAt: startedAt.toISOString(),
  })
  try {
    const scriptUnits = await resolved.loadScriptUnits(payload.projectId)
    const narration = await resolved.synthesize({
      ...payload,
      units: scriptUnits.map(({ unitId, text }) => ({ unitId, text })),
      billingContext: payload.billingContext,
    })
    const audioManifest = buildMeasuredAudioManifest(scriptUnits, narration)
    const audioAllocation = buildMeasuredAudioAllocation(scriptUnits, audioManifest)
    const artifactId = await resolved.persistResult({
      ...payload,
      audioManifest,
      audioAllocation,
    })
    const completedAt = await resolved.now()
    await resolved.updateMediaState(payload.nodeId, {
      status: 'ready',
      artifactId,
      completedAt: completedAt.toISOString(),
    })
    for (const nodeId of await resolved.listWakeNodeIds(payload.projectId)) {
      await resolved.advance(payload.projectId, nodeId)
    }
  } catch (error) {
    const completedAt = await resolved.now()
    await resolved.updateMediaState(
      payload.nodeId,
      projectMediaErrorState(error, payload.nodeId, completedAt)
    )
    throw error
  }
}

function projectMediaErrorState(
  error: unknown,
  nodeId: string,
  completedAt: Date,
): MediaState {
  if (error instanceof ProviderQueueDeferral && error.retryAt) {
    return {
      status: 'waiting',
      code: 'PROVIDER_POOL_WAIT',
      message: `${error.providerLabel}正在等待可用调用窗口`,
      resumeAt: error.retryAt,
      providerLabel: error.providerLabel,
    }
  }
  return {
    status: 'failed',
    error: classifyWorkflowError(error, {
      stage: 'MEDIA_NARRATION',
      sourceNodeId: nodeId,
    }),
    completedAt: completedAt.toISOString(),
  }
}

export function registerMediaNarrationHandler(
  targetQueue: QueueAdapter = defaultQueue,
  run: typeof runMediaNarrationJob = runMediaNarrationJob
): void {
  targetQueue.register('media-narration', async (job) => {
    job.signal?.throwIfAborted()
    await run(mediaNarrationJobSchema.parse({
      ...job.payload,
      billingContext: {
        attemptId: job.id,
        invocationNo: billingInvocationNo('narration', 1),
      },
    }))
    job.signal?.throwIfAborted()
  })
}

export async function enqueueMediaNarration(
  input: MediaNarrationJobInput,
  targetQueue: QueueAdapter = defaultQueue,
  preflight: () => Promise<void> = assertNarrationBillingAvailable,
): Promise<string> {
  const payload = mediaNarrationJobSchema.parse(input)
  await preflight()
  return targetQueue.enqueue('media-narration', payload, {
    projectId: payload.projectId,
    nodeId: payload.nodeId,
  })
}

async function assertNarrationBillingAvailable(): Promise<void> {
  const target = await describeMediaProvider('tts')
  if (isManagedProvider(target.provider)) {
    await assertBillingAvailable()
  }
}

async function createDefaultDependencies(): Promise<MediaNarrationDependencies> {
  const database = await getDb()
  const source = new DirectorArtifactSource(database, storage)
  const writer = new DirectorArtifactWriter(database, storage)
  return {
    now: async () => readDatabaseClock(database),
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
            eq(canvasNodes.workspaceId, currentWorkspaceId()),
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
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
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
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.id, nodeId)
        )
      )
  })
}
