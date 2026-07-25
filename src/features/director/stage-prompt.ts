import {
  buildScoreAssemblePrompt,
  buildShotSfxPrompt,
  buildShotSubtitlePrompt,
  scoreAssemblePromptInputSchema,
  shotSfxPromptInputSchema,
  shotSubtitlePromptInputSchema,
} from './prompts/assemble'
import { buildDirectPrompt, directPromptInputSchema } from './prompts/direct'
import {
  buildFabricatePrompt,
  fabricatePromptInputSchema,
} from './prompts/fabricate'
import {
  buildExportFinalizePrompt,
  buildShotQaPrompt,
  exportFinalizePromptInputSchema,
  shotQaPromptInputSchema,
} from './prompts/finalize'
import { buildIngestPrompt, ingestPromptInputSchema } from './prompts/ingest'
import {
  buildShotSpecPrompt,
  shotSpecPromptInputSchema,
} from './prompts/shot-spec'
import type { PipelineStage } from './types'

export interface StagePromptContext {
  projectTitle: string
  projectScript: string
  nodeType: string | null
  directorInput: unknown
}

/** 将持久化阶段输入路由到项目原生的类型化 prompt builder。 */
export function buildStagePrompt(
  stage: PipelineStage,
  context: StagePromptContext
): string {
  switch (stage) {
    case 'INGEST':
      return buildIngestPrompt(
        ingestPromptInputSchema.parse(withScriptFallback(context))
      )
    case 'DIRECT':
      return buildDirectPrompt(directPromptInputSchema.parse(context.directorInput))
    case 'SHOT_SPEC':
      return buildShotSpecPrompt(
        shotSpecPromptInputSchema.parse(context.directorInput)
      )
    case 'FABRICATE':
      return buildFabricatePrompt(
        fabricatePromptInputSchema.parse(context.directorInput)
      )
    case 'ASSEMBLE':
      return buildAssembleStagePrompt(context)
    case 'FINALIZE':
      return buildFinalizeStagePrompt(context)
  }
}

function buildAssembleStagePrompt(context: StagePromptContext): string {
  switch (context.nodeType) {
    case 'score':
      return buildScoreAssemblePrompt(
        scoreAssemblePromptInputSchema.parse(context.directorInput)
      )
    case 'shot-sfx':
      return buildShotSfxPrompt(shotSfxPromptInputSchema.parse(context.directorInput))
    case 'shot-subtitle':
      return buildShotSubtitlePrompt(
        shotSubtitlePromptInputSchema.parse(context.directorInput)
      )
    default:
      throw new Error(`未知 ASSEMBLE 节点类型：${context.nodeType ?? 'null'}`)
  }
}

function buildFinalizeStagePrompt(context: StagePromptContext): string {
  switch (context.nodeType) {
    case 'export':
      return buildExportFinalizePrompt(
        exportFinalizePromptInputSchema.parse(context.directorInput)
      )
    case 'shot-qa':
      return buildShotQaPrompt(shotQaPromptInputSchema.parse(context.directorInput))
    default:
      throw new Error(`未知 FINALIZE 节点类型：${context.nodeType ?? 'null'}`)
  }
}

function withScriptFallback(context: StagePromptContext): unknown {
  if (
    context.directorInput !== null &&
    typeof context.directorInput === 'object' &&
    !Array.isArray(context.directorInput)
  ) {
    return { rawScript: context.projectScript, ...context.directorInput }
  }
  return { rawScript: context.projectScript }
}
