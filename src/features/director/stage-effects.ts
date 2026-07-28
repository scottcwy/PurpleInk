import 'server-only'
import { getDb } from '@/lib/db/client'
import { storage } from '@/lib/storage'
import {
  AudioRuntimeRepository,
  generateSubtitle,
  type LoadedNarration,
  type SubtitleInput,
} from '@/features/audio'
import { runShotQaCheck } from '@/features/render/qa-check'
import { runShotVisionQa } from '@/features/render/vision-qa'
import { billingInvocationNo } from '@/features/billing'
import type { DirectorStageContext } from './runtime-repository'
import {
  shotSfxPromptInputSchema,
  shotSubtitlePromptInputSchema,
} from './prompts/assemble'
import { shotQaPromptInputSchema } from './prompts/finalize'

interface StageEffectDependencies {
  generateSubtitle: (input: SubtitleInput) => Promise<unknown>
  loadNarration: (
    projectId: string,
    unitId: string
  ) => Promise<LoadedNarration>
  runRuleQa: (projectId: string, qaNodeId: string) => Promise<unknown>
  runVisionQa: (input: {
    projectId: string
    qaNodeId: string
    attemptId: string
    shot: Record<string, unknown> & { id: string }
  }) => Promise<unknown>
}

export type DirectorStageEffect = (
  context: DirectorStageContext
) => Promise<void>

/**
 * 把 Director 的类型化阶段提交接到音频域真实副作用，保持 runner 不含领域细节。
 *
 * 旁白只在 INGEST 合成一次；ASSEMBLE 的两个分镜节点都是消费方：
 * `shot-sfx` 核验本镜旁白确实存在且字节可信，`shot-subtitle` 用同一份音频做 ASR。
 */
export function createDirectorStageEffect(
  dependencies: StageEffectDependencies
): DirectorStageEffect {
  return async (context) => {
    if (context.nodeType === 'shot-sfx') {
      const input = shotSfxPromptInputSchema.parse(context.directorInput)
      await dependencies.loadNarration(
        context.projectId,
        input.shotAllocation.audioUnitId
      )
      return
    }
    if (context.nodeType === 'shot-subtitle') {
      const input = shotSubtitlePromptInputSchema.parse(context.directorInput)
      const source = await dependencies.loadNarration(
        context.projectId,
        input.shotAllocation.audioUnitId
      )
      await dependencies.generateSubtitle({
        projectId: context.projectId,
        nodeId: context.nodeId,
        shotId: input.shot.id,
        script: input.scriptUnit.text,
        audioArtifactId: source.audioArtifactId,
        audioKey: source.audioKey,
        audioBytes: source.audioBytes,
        audioFormat: source.audioFormat,
        // Director 文本调用占用低位 invocationNo；100 是 ASR 副作用的保留槽，
        // 避免工具循环、修复调用与字幕计费记录发生唯一键冲突。
        ...(context.attemptId
          ? {
              billingContext: {
                attemptId: context.attemptId,
                invocationNo: billingInvocationNo('subtitle-asr', 1),
              },
            }
          : {}),
      })
      return
    }
    if (context.nodeType === 'shot-qa') {
      if (!context.attemptId) {
        throw new Error('Vision QA 缺少可审计的 attemptId')
      }
      const input = shotQaPromptInputSchema.parse(context.directorInput)
      await dependencies.runRuleQa(context.projectId, context.nodeId)
      await dependencies.runVisionQa({
        projectId: context.projectId,
        qaNodeId: context.nodeId,
        attemptId: context.attemptId,
        shot: input.shot,
      })
    }
  }
}

export const runDirectorStageEffect = createDirectorStageEffect({
  generateSubtitle,
  loadNarration: async (projectId, unitId) =>
    new AudioRuntimeRepository(await getDb(), storage).loadNarration(
      projectId,
      unitId
    ),
  runRuleQa: runShotQaCheck,
  runVisionQa: runShotVisionQa,
})
