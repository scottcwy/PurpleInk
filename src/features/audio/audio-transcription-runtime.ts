import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import {
  assertNodeExecutionActive,
  materializeShotLanes,
  transitionNodeStatus,
} from '@/features/canvas'
import {
  enableAudioDirectorContinuation,
} from '@/features/director/audio-continuation'
import { resumeProjectPipeline } from '@/features/director/advance'
import { patchNodePayload } from '@/features/director/runtime-node-data'
import { PostgresProjectSourceRepository } from '@/features/projects'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import { readDatabaseClock } from '@/lib/db/database-clock'
import {
  assertNodeExecutionFence,
  type NodeExecutionFence,
  type TransactionContext,
} from '@/lib/db/transaction'
import { canvasNodes, projects, taskAttempts } from '@/lib/db/schema/index'
import { storage } from '@/lib/storage'
import {
  persistUserAudioArtifacts,
  persistUserAudioSourceArtifact,
} from './user-audio-artifacts'
import {
  decodeUserRecording,
} from './user-audio-slicer'
import { transcribeRoutedSpeech } from './media-provider'
import type {
  AudioTranscriptionDependencies,
  AudioTranscriptionState,
} from './audio-transcription-job'
import { AudioAttemptArtifactWriter } from './attempt-artifact-writer'
import { AudioArtifactCleanupService } from './audio-artifact-cleanup'

export async function createAudioTranscriptionDependencies():
Promise<AudioTranscriptionDependencies> {
  const database = await getDb()
  const sourceRepository = new PostgresProjectSourceRepository(
    database,
    currentWorkspaceId(),
  )
  const writer = new AudioAttemptArtifactWriter(database, storage)
  const cleanup = new AudioArtifactCleanupService(database, storage)
  return {
    loadSource: async (projectId) => {
      const record = await sourceRepository.get(projectId)
      if (!record || record.sourcePayload.kind !== 'audio') {
        throw new Error('录音项目缺少可执行的来源记录')
      }
      return {
        source: record.sourcePayload,
        sourceFingerprint: record.sourceFingerprint,
      }
    },
    readSourceBytes: (storageKey) => storage.get(storageKey),
    decode: decodeUserRecording,
    transcribe: transcribeRoutedSpeech,
    persistSource: (input) =>
      persistUserAudioSourceArtifact(input, { storage, writer, cleanup }),
    persistArtifacts: (input) =>
      persistUserAudioArtifacts(input, { storage, writer, cleanup }),
    assertActive: assertNodeExecutionActive,
    updateProjectScript: (projectId, transcript, execution) =>
      updateAudioProjectScript(database, projectId, transcript, execution),
    materialize: (projectId, shots, execution) =>
      materializeShotLanes(projectId, shots, execution),
    transition: (nodeId, status, execution) =>
      transitionNodeStatus(nodeId, status, execution ? { execution } : undefined),
    recordState: (nodeId, state, outputContentHash, execution) =>
      persistTranscriptionState(
        database,
        nodeId,
        state,
        outputContentHash,
        execution,
      ),
    activateContinuation: (projectId, nodeId, execution) =>
      enableAudioDirectorContinuation(
        projectId,
        execution ? { nodeId, fence: execution } : undefined,
        database,
      ),
    advance: (projectId, nodeId, execution) =>
      resumeProjectPipeline(
        projectId,
        undefined,
        execution ? { nodeId, fence: execution } : undefined,
      ),
    now: async () => readDatabaseClock(database),
  }
}

async function updateAudioProjectScript(
  database: Awaited<ReturnType<typeof getDb>>,
  projectId: string,
  transcript: string,
  execution?: NodeExecutionFence,
): Promise<void> {
  await database.transaction(async (transaction) => {
    if (execution) {
      await assertNodeExecutionFence(
        transaction,
        { id: await executionNodeId(transaction, execution), projectId },
        execution,
      )
    }
    const [updated] = await transaction
      .update(projects)
      .set({ script: transcript, updatedAt: sql`now()` })
      .where(
        and(
          eq(projects.workspaceId, currentWorkspaceId()),
          eq(projects.id, projectId),
          eq(projects.workflowKind, 'audio'),
        ),
      )
      .returning({ id: projects.id })
    if (!updated) throw new Error('录音项目不存在或工作流类型不匹配')
  })
}

async function persistTranscriptionState(
  database: Awaited<ReturnType<typeof getDb>>,
  nodeId: string,
  state: AudioTranscriptionState,
  outputContentHash?: string,
  execution?: NodeExecutionFence,
): Promise<void> {
  await database.transaction(async (transaction) => {
    const [node] = await transaction
      .select({ data: canvasNodes.data })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.id, nodeId),
        ),
      )
      .limit(1)
      .for('update')
    if (!node) throw new Error('录音转写节点不存在')
    if (execution) {
      await assertNodeExecutionFence(
        transaction,
        { id: nodeId, projectId: execution.projectId },
        execution,
      )
    }
    await transaction
      .update(canvasNodes)
      .set({
        data: patchNodePayload(node.data, {
          audioTranscription: state,
          ...(outputContentHash ? { outputContentHash } : {}),
        }),
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.id, nodeId),
        ),
      )
  })
}

async function executionNodeId(
  transaction: TransactionContext,
  execution: NodeExecutionFence,
): Promise<string> {
  const [attempt] = await transaction
    .select({ entityId: taskAttempts.entityId })
    .from(taskAttempts)
    .where(and(
      eq(taskAttempts.workspaceId, currentWorkspaceId()),
      eq(taskAttempts.id, execution.attemptId),
      eq(taskAttempts.entityType, 'node'),
    ))
    .limit(1)
  if (!attempt) throw new Error('STALE_ATTEMPT')
  return attempt.entityId
}
