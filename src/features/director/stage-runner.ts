import 'server-only'
import { getDb } from '@/lib/db/client'
import {
  assertNodeExecutionActive,
  transitionNodeStatus,
} from '@/features/canvas'
import { createDirectorSession, type DirectorSession } from './pi-session'
import { DirectorRuntimeRepository, type DirectorStageContext } from './runtime-repository'
import { buildStagePrompt } from './stage-prompt'
import { generateValidatedArtifact } from './stage-artifact-gate'
import { commitStageResult } from './stage-result-committer'
import {
  prepareStageResult,
} from './stage-result'
import { storage } from '@/lib/storage'
import { streamBus } from '@/lib/stream/stream-bus'
import { writeValidatedArtifact } from './tools/write-artifact'
import { classifyWorkflowError } from '@/features/canvas/workflow-error'
import { advancePipeline } from './advance'
import { ProviderQueueDeferral } from '@/features/ai/provider-queue-deferral'

export { MAX_GATE_RETRIES } from './stage-artifact-gate'

import type {
  StageRunner,
  StageRunnerDependencies,
} from './stage-runner-contract'
import {
  advanceWithoutMasking,
  scheduleMediaWithoutMasking,
  transitionStageNode,
} from './stage-runner-guards'

let defaultRunner: Promise<StageRunner> | undefined

/** 首次真正执行作业时才打开 Postgres，模块导入保持无副作用。 */
export const runStage: StageRunner = async (
  projectId,
  nodeId,
  stage,
  attemptId,
  signal,
) => {
  defaultRunner ??= createDefaultRunner()
  return (await defaultRunner)(projectId, nodeId, stage, attemptId, signal)
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
    commitResult: async (context, result, artifact, signal) =>
      commitStageResult(repository, context, result, artifact, signal),
    runStageEffect: async (context, signal) => {
      if (
        context.nodeType !== 'shot-sfx' &&
        context.nodeType !== 'shot-subtitle' &&
        context.nodeType !== 'shot-qa'
      ) {
        return
      }
      const { runDirectorStageEffect } = await import('./stage-effects')
      await runDirectorStageEffect(context, signal)
    },
    advancePipeline: (projectId, nodeId, execution) =>
      advancePipeline(projectId, nodeId, undefined, execution),
    scheduleMediaNarration: async (input) => {
      input.signal?.throwIfAborted()
      if (input.attemptId) {
        await assertNodeExecutionActive(input.nodeId, {
          projectId: input.projectId,
          attemptId: input.attemptId,
          signal: input.signal,
        })
      }
      const { enqueueMediaNarration } = await import(
        '@/features/audio/narration-queue-handler'
      )
      const jobId = await enqueueMediaNarration({
        projectId: input.projectId,
        nodeId: input.nodeId,
      })
      input.signal?.throwIfAborted()
      return jobId
    },
  })
}

export function createStageRunner(
  dependencies: StageRunnerDependencies
): StageRunner {
  return async (projectId, nodeId, stage, attemptId, signal) => {
    const streamKey = `${projectId}:${nodeId}`
    let session: DirectorSession | undefined
    let closed = false
    let closeAttempted = false
    let sessionPointerAttempted = false
    try {
      signal?.throwIfAborted()
      await transitionStageNode(
        dependencies.transitionNodeStatus,
        projectId,
        nodeId,
        'running',
        attemptId,
        signal,
      )
      const context = await dependencies.repository.loadStageContext(
        projectId,
        nodeId,
        stage
      )
      signal?.throwIfAborted()
      const executionContext: DirectorStageContext = attemptId
        ? { ...context, attemptId }
        : context
      if (
        context.nodeType === 'shot-subtitle'
        && attemptId
        && await dependencies.repository.shouldResumeCommittedEffect?.(
          attemptId,
          nodeId,
        )
      ) {
        await dependencies.runStageEffect(executionContext, signal)
        signal?.throwIfAborted()
        await transitionStageNode(
          dependencies.transitionNodeStatus,
          projectId,
          nodeId,
          'success',
          attemptId,
          signal,
        )
        await advanceWithoutMasking(
          dependencies.advancePipeline,
          projectId,
          nodeId,
          attemptId,
          signal,
        )
        return
      }
      const prompt = dependencies.buildPrompt(stage, context)
      session = await dependencies.createSession({
        projectId,
        nodeId,
        ...(attemptId ? { attemptId } : {}),
        nodeType: context.nodeType,
        stage,
        resumeSessionKey: context.resumeSessionKey,
      })
      const { displayText, prepared, artifact } = await generateValidatedArtifact({
        stage,
        context: executionContext,
        session,
        initialPrompt: prompt,
        prepareResult: dependencies.prepareResult,
        writeArtifact: dependencies.writeArtifact,
        signal,
      })
      signal?.throwIfAborted()
      await dependencies.commitResult(executionContext, prepared, artifact, signal)
      signal?.throwIfAborted()
      await dependencies.runStageEffect(executionContext, signal)
      signal?.throwIfAborted()
      await dependencies.repository.persistStreamLog({
        projectId,
        nodeId,
        stage,
        text: displayText,
        ...(attemptId ? { attemptId } : {}),
        ...(signal ? { signal } : {}),
      })
      signal?.throwIfAborted()
      closeAttempted = true
      await session.close()
      closed = true
      signal?.throwIfAborted()
      sessionPointerAttempted = true
      await dependencies.repository.registerArtifactPointer({
        projectId,
        nodeId,
        kind: 'pi-session',
        storageKey: session.storageKey,
        ...(attemptId ? { attemptId } : {}),
        ...(signal ? { signal } : {}),
      })
      signal?.throwIfAborted()
      await transitionStageNode(
        dependencies.transitionNodeStatus,
        projectId,
        nodeId,
        'success',
        attemptId,
        signal,
      )
      signal?.throwIfAborted()
      streamBus.markDone(streamKey)
      if (stage === 'INGEST' && dependencies.scheduleMediaNarration) {
        await scheduleMediaWithoutMasking(dependencies.scheduleMediaNarration, {
          projectId,
          nodeId,
          ...(attemptId ? { attemptId } : {}),
          ...(signal ? { signal } : {}),
        })
      }
      await advanceWithoutMasking(
        dependencies.advancePipeline,
        projectId,
        nodeId,
        attemptId,
        signal,
      )
    } catch (error) {
      const cleanupErrors: unknown[] = []
      if (session && !closeAttempted) {
        closeAttempted = true
        try {
          await session.close()
          closed = true
        } catch (closeError) {
          cleanupErrors.push(closeError)
        }
      }
      if (signal?.aborted) {
        throw signal.reason ?? error
      }
      if (session && closed && !sessionPointerAttempted) {
        try {
          sessionPointerAttempted = true
          await dependencies.repository.registerArtifactPointer({
            projectId,
            nodeId,
            kind: 'pi-session',
            storageKey: session.storageKey,
            ...(attemptId ? { attemptId } : {}),
            ...(signal ? { signal } : {}),
          })
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
      }
      if (error instanceof ProviderQueueDeferral) {
        try {
          await dependencies.repository.persistStreamLog({
            projectId,
            nodeId,
            stage,
            text: streamBus.getSnapshot(streamKey).text,
            ...(attemptId ? { attemptId } : {}),
            ...(signal ? { signal } : {}),
          })
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
        if (cleanupErrors.length === 0) {
          streamBus.markDone(streamKey)
          throw error
        }
      }
      try {
        await transitionStageNode(
          dependencies.transitionNodeStatus,
          projectId,
          nodeId,
          'failed',
          attemptId,
          signal,
        )
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
        await dependencies.repository.persistStreamLog({
          projectId,
          nodeId,
          stage,
          text: streamBus.getSnapshot(streamKey).text,
          ...(attemptId ? { attemptId } : {}),
          ...(signal ? { signal } : {}),
        })
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      const projected = classifyWorkflowError(error, { stage })
      streamBus.markError(streamKey, {
        stage,
        message: projected.message,
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
