import 'server-only'
import { getDb } from '@/lib/db/client'
import { transitionNodeStatus } from '@/features/canvas'
import { createDirectorSession, type DirectorSession } from './pi-session'
import { DirectorRuntimeRepository, type DirectorStageContext } from './runtime-repository'
import { buildStagePrompt } from './stage-prompt'
import { generateValidatedArtifact } from './stage-artifact-gate'
import { commitStageResult } from './stage-result-committer'
import {
  prepareStageResult,
  type PreparedStageResult,
} from './stage-result'
import { storage } from '@/lib/storage'
import { streamBus } from '@/lib/stream/stream-bus'
import {
  writeValidatedArtifact,
  type ArtifactCommitResult,
  type WriteArtifactInput,
} from './tools/write-artifact'
import type { PipelineStage } from './types'
import { advancePipeline } from './advance'

export { MAX_GATE_RETRIES } from './stage-artifact-gate'

interface StageRepository {
  loadStageContext(
    projectId: string,
    nodeId: string,
    stage: PipelineStage
  ): Promise<DirectorStageContext>
  registerArtifactPointer(input: {
    projectId: string
    nodeId: string
    kind: string
    storageKey: string
  }): Promise<string>
  recordStageError(
    nodeId: string,
    stage: PipelineStage,
    error: unknown
  ): Promise<void>
  recordStageOutput(
    nodeId: string,
    result: PreparedStageResult,
    artifact: ArtifactCommitResult
  ): Promise<void>
  persistStreamLog(
    projectId: string,
    nodeId: string,
    stage: PipelineStage,
    text: string
  ): Promise<void>
}

interface StageRunnerDependencies {
  repository: StageRepository
  transitionNodeStatus: typeof transitionNodeStatus
  createSession: typeof createDirectorSession
  buildPrompt: typeof buildStagePrompt
  writeArtifact: (input: WriteArtifactInput) => Promise<ArtifactCommitResult>
  prepareResult: (
    context: DirectorStageContext,
    rawContent: string
  ) => PreparedStageResult | Promise<PreparedStageResult>
  commitResult: (
    context: DirectorStageContext,
    result: PreparedStageResult,
    artifact: ArtifactCommitResult
  ) => Promise<void>
  runStageEffect: (
    context: DirectorStageContext,
    result: PreparedStageResult,
    artifact: ArtifactCommitResult
  ) => Promise<void>
  advancePipeline: (
    projectId: string,
    completedNodeId: string
  ) => Promise<unknown>
}

type StageRunner = (
  projectId: string,
  nodeId: string,
  stage: PipelineStage
) => Promise<void>

let defaultRunner: Promise<StageRunner> | undefined

/** 首次真正执行作业时才打开 Postgres，模块导入保持无副作用。 */
export const runStage: StageRunner = async (projectId, nodeId, stage) => {
  defaultRunner ??= createDefaultRunner()
  return (await defaultRunner)(projectId, nodeId, stage)
}

async function createDefaultRunner(): Promise<StageRunner> {
  const repository = new DirectorRuntimeRepository(await getDb(), storage)
  return createStageRunner({
    repository,
    transitionNodeStatus,
    createSession: createDirectorSession,
    buildPrompt: buildStagePrompt,
    writeArtifact: writeValidatedArtifact,
    prepareResult: prepareStageResult,
    commitResult: async (context, result, artifact) =>
      commitStageResult(repository, context, result, artifact),
    runStageEffect: async (context) => {
      if (
        context.nodeType !== 'shot-sfx' &&
        context.nodeType !== 'shot-subtitle' &&
        context.nodeType !== 'shot-qa'
      ) {
        return
      }
      const { runDirectorStageEffect } = await import('./stage-effects')
      await runDirectorStageEffect(context)
    },
    advancePipeline,
  })
}

export function createStageRunner(
  dependencies: StageRunnerDependencies
): StageRunner {
  return async (projectId, nodeId, stage) => {
    const context = await dependencies.repository.loadStageContext(projectId, nodeId, stage)
    const streamKey = `${projectId}:${nodeId}`
    await dependencies.transitionNodeStatus(nodeId, 'running')
    let session: DirectorSession | undefined
    let closed = false
    try {
      const prompt = dependencies.buildPrompt(stage, context)
      session = await dependencies.createSession({
        projectId,
        nodeId,
        nodeType: context.nodeType,
        stage,
        resumeSessionKey: context.resumeSessionKey,
      })
      await dependencies.repository.registerArtifactPointer({
        projectId,
        nodeId,
        kind: 'pi-session',
        storageKey: session.storageKey,
      })
      const { displayText, prepared, artifact } = await generateValidatedArtifact({
        stage,
        context,
        session,
        initialPrompt: prompt,
        prepareResult: dependencies.prepareResult,
        writeArtifact: dependencies.writeArtifact,
      })
      await dependencies.commitResult(context, prepared, artifact)
      await dependencies.runStageEffect(context, prepared, artifact)
      await dependencies.repository.persistStreamLog(
        projectId,
        nodeId,
        stage,
        displayText
      )
      streamBus.markDone(streamKey)
      await session.close()
      closed = true
      await dependencies.transitionNodeStatus(nodeId, 'success')
      await advanceWithoutMasking(
        dependencies.advancePipeline,
        projectId,
        nodeId
      )
    } catch (error) {
      if (session && !closed) await closeWithoutMasking(session)
      const cleanupErrors: unknown[] = []
      try {
        await dependencies.transitionNodeStatus(nodeId, 'failed')
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      try {
        await dependencies.repository.recordStageError(nodeId, stage, error)
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      // 落已流出的部分文本（可能为空）；持久化失败不掩盖主错误，并入清理链。
      try {
        await dependencies.repository.persistStreamLog(
          projectId,
          nodeId,
          stage,
          streamBus.getSnapshot(streamKey).text
        )
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      streamBus.markError(streamKey, {
        stage,
        message: error instanceof Error ? error.message : String(error),
      })
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          `Director 阶段失败且清理不完整：${stage}`
        )
      }
      throw error
    }
  }
}

async function advanceWithoutMasking(
  advance: StageRunnerDependencies['advancePipeline'],
  projectId: string,
  nodeId: string
): Promise<void> {
  try {
    await advance(projectId, nodeId)
  } catch (error) {
    console.error('[director] 下游自动推进失败', {
      projectId,
      nodeId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

async function closeWithoutMasking(session: DirectorSession): Promise<void> {
  try {
    await session.close()
  } catch {
    // 主失败原因已由 stage runner 捕获；close 错误不覆盖它。
  }
}
