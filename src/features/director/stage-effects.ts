import 'server-only'
import { getDb } from '@/lib/db/client'
import { storage } from '@/lib/storage'
import {
  AudioRuntimeRepository,
  generateSubtitle,
  generateVoiceover,
  type LoadedVoiceover,
  type SubtitleInput,
  type VoiceoverInput,
} from '@/features/audio'
import { runShotQaCheck } from '@/features/render/qa-check'
import { runShotVisionQa } from '@/features/render/vision-qa'
import type { DirectorStageContext } from './runtime-repository'
import {
  shotSfxPromptInputSchema,
  shotSubtitlePromptInputSchema,
} from './prompts/assemble'
import { shotQaPromptInputSchema } from './prompts/finalize'

interface StageEffectDependencies {
  generateVoiceover: (input: VoiceoverInput) => Promise<unknown>
  generateSubtitle: (input: SubtitleInput) => Promise<unknown>
  loadVoiceover: (
    projectId: string,
    shotId: string
  ) => Promise<LoadedVoiceover>
  runRuleQa: (projectId: string, qaNodeId: string) => Promise<unknown>
  runVisionQa: (input: {
    projectId: string
    qaNodeId: string
    shot: Record<string, unknown> & { id: string }
  }) => Promise<unknown>
}

export type DirectorStageEffect = (
  context: DirectorStageContext
) => Promise<void>

/** 把 Director 的类型化阶段提交接到音频域真实副作用，保持 runner 不含领域细节。 */
export function createDirectorStageEffect(
  dependencies: StageEffectDependencies
): DirectorStageEffect {
  return async (context) => {
    if (context.nodeType === 'shot-sfx') {
      const input = shotSfxPromptInputSchema.parse(context.directorInput)
      await dependencies.generateVoiceover({
        projectId: context.projectId,
        nodeId: context.nodeId,
        shotId: input.shot.id,
        text: input.scriptUnit.text,
      })
      return
    }
    if (context.nodeType === 'shot-subtitle') {
      const input = shotSubtitlePromptInputSchema.parse(context.directorInput)
      const source = await dependencies.loadVoiceover(
        context.projectId,
        input.shot.id
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
      })
      return
    }
    if (context.nodeType === 'shot-qa') {
      const input = shotQaPromptInputSchema.parse(context.directorInput)
      await dependencies.runRuleQa(context.projectId, context.nodeId)
      await dependencies.runVisionQa({
        projectId: context.projectId,
        qaNodeId: context.nodeId,
        shot: input.shot,
      })
    }
  }
}

export const runDirectorStageEffect = createDirectorStageEffect({
  generateVoiceover,
  generateSubtitle,
  loadVoiceover: async (projectId, shotId) =>
    new AudioRuntimeRepository(await getDb(), storage).loadVoiceover(
      projectId,
      shotId
    ),
  runRuleQa: runShotQaCheck,
  runVisionQa: runShotVisionQa,
})
