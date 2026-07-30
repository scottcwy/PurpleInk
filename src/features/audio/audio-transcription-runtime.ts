import 'server-only'
import { and, eq } from 'drizzle-orm'
import {
  materializeShotLanes,
  transitionNodeStatus,
} from '@/features/canvas'
import { startProjectPipeline } from '@/features/director/advance'
import { DirectorArtifactWriter } from '@/features/director/runtime-artifact-writer'
import { patchNodePayload } from '@/features/director/runtime-node-data'
import { PostgresProjectSourceRepository } from '@/features/projects'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import { canvasNodes, projects } from '@/lib/db/schema/index'
import { storage } from '@/lib/storage'
import {
  persistUserAudioArtifacts,
} from './user-audio-artifacts'
import {
  decodeUserRecording,
} from './user-audio-slicer'
import { transcribeRoutedSpeech } from './media-provider'
import type {
  AudioTranscriptionDependencies,
  AudioTranscriptionState,
} from './audio-transcription-job'

export async function createAudioTranscriptionDependencies():
Promise<AudioTranscriptionDependencies> {
  const database = await getDb()
  const sourceRepository = new PostgresProjectSourceRepository(
    database,
    currentWorkspaceId(),
  )
  const writer = new DirectorArtifactWriter(database, storage)
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
    persistArtifacts: (input) =>
      persistUserAudioArtifacts(input, { storage, writer }),
    updateProjectScript: (projectId, transcript) =>
      updateAudioProjectScript(database, projectId, transcript),
    materialize: materializeShotLanes,
    transition: transitionNodeStatus,
    recordState: (nodeId, state, outputContentHash) =>
      persistTranscriptionState(database, nodeId, state, outputContentHash),
    // ASR 是 audio 项目的真实入口；成功后在这里开启 autopilot 并续接 Director。
    advance: startProjectPipeline,
    now: () => new Date(),
  }
}

async function updateAudioProjectScript(
  database: Awaited<ReturnType<typeof getDb>>,
  projectId: string,
  transcript: string,
): Promise<void> {
  const [updated] = await database
    .update(projects)
    .set({ script: transcript, updatedAt: new Date() })
    .where(
      and(
        eq(projects.workspaceId, currentWorkspaceId()),
        eq(projects.id, projectId),
        eq(projects.workflowKind, 'audio'),
      ),
    )
    .returning({ id: projects.id })
  if (!updated) throw new Error('录音项目不存在或工作流类型不匹配')
}

async function persistTranscriptionState(
  database: Awaited<ReturnType<typeof getDb>>,
  nodeId: string,
  state: AudioTranscriptionState,
  outputContentHash?: string,
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
    await transaction
      .update(canvasNodes)
      .set({
        data: patchNodePayload(node.data, {
          audioTranscription: state,
          ...(outputContentHash ? { outputContentHash } : {}),
        }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.id, nodeId),
        ),
      )
  })
}
