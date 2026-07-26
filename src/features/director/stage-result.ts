import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  MASTER_RESOLUTION_PRESET,
  resolutionForPreset,
  type ShotLaneSeed,
} from '@/features/canvas/contracts'
import type { NarrationInput, NarrationResult } from '@/features/audio'
import { fabricatePromptInputSchema } from './prompts/fabricate'
import {
  buildMeasuredAudioAllocation,
  buildMeasuredAudioManifest,
  shotIdFor,
} from './audio-timing'
import { ingestStageResultSchema, type ScriptUnit } from './schemas/ingest'
import { directorShotPlanSchema } from './schemas/director-shot-plan'
import type { DirectorStageContext } from './runtime-repository'
import { ArtifactValidationError } from './artifact-validation-error'
import { shotSpecTargetSchema } from './prompts/shot-spec'

const renderSpecSchema = z
  .object({
    fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
    durationInFrames: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    seed: z.number().int().nonnegative(),
  })
  .strict()

export type PreparedStageResult = {
  content: string
  ingestShots?: ShotLaneSeed[]
  renderSpec?: z.infer<typeof renderSpecSchema>
}

export interface StageResultDependencies {
  synthesizeNarration: (input: NarrationInput) => Promise<NarrationResult>
}

/**
 * 将不可信模型文本归一化为可提交的阶段结果。
 *
 * INGEST 是异步的：音频时长必须先由真实 TTS 合成并实测，
 * 才能派生出 allocation 与后续 FABRICATE 的帧数。合成失败即整个阶段失败，
 * 不产出任何占位产物。
 */
export async function prepareStageResult(
  context: DirectorStageContext,
  rawContent: string,
  dependencies: StageResultDependencies = defaultDependencies()
): Promise<PreparedStageResult> {
  if (context.stage === 'INGEST') {
    const parsed = ingestStageResultSchema.parse(parseJsonObject(rawContent))
    return prepareIngestResult(context, parsed.scriptUnits, dependencies)
  }

  if (context.stage === 'FABRICATE') {
    const input = fabricatePromptInputSchema.parse(context.directorInput)
    const allocation = input.audioAllocation.shots.find(
      (shot) => shot.id === input.shot.id
    )
    if (!allocation) {
      throw new Error(`FABRICATE 缺少分镜 ${input.shot.id} 的音频分配`)
    }
    return {
      content: rawContent,
      renderSpec: renderSpecSchema.parse({
        fps: input.audioAllocation.fps,
        durationInFrames: allocation.durationInFrames,
        // 母版画幅（与导出预设同一母版）；分辨率仅在导出时缩放，不下沉到渲染层。
        ...resolutionForPreset(MASTER_RESOLUTION_PRESET),
        seed: stableSeed(context.projectId, context.nodeId, input.shot.id),
      }),
    }
  }

  if (context.stage === 'DIRECT') {
    const { masterPlan, styleBible } = parseDirectOutput(rawContent)
    return { content: JSON.stringify({ masterPlan, styleBible }) }
  }

  if (context.stage === 'SHOT_SPEC') {
    const parsed = directorShotPlanSchema.parse(parseJsonObject(rawContent))
    const { target } = z
      .object({ target: shotSpecTargetSchema })
      .passthrough()
      .parse(context.directorInput)
    const errors = validateShotSpecTarget(parsed.shots, target)
    if (errors.length > 0) throw new ArtifactValidationError(errors)
    return { content: JSON.stringify(parsed) }
  }

  return { content: rawContent }
}

function validateShotSpecTarget(
  shots: Array<{
    id: string
    sourceUnitIds?: unknown
    audioBinding?: unknown
  }>,
  target: {
    laneKey: string
    sourceUnitId: string
  }
): string[] {
  const errors: string[] = []
  if (shots.length !== 1) {
    errors.push(`shots 必须且只能包含当前镜头 ${target.laneKey}`)
    return errors
  }
  const [shot] = shots
  if (!shot || shot.id !== target.laneKey) {
    errors.push(`shots.0.id 必须为 ${target.laneKey}`)
    return errors
  }
  if (
    !Array.isArray(shot.sourceUnitIds) ||
    shot.sourceUnitIds.length !== 1 ||
    shot.sourceUnitIds[0] !== target.sourceUnitId
  ) {
    errors.push(`shots.0.sourceUnitIds 必须且只能包含 ${target.sourceUnitId}`)
  }
  const binding =
    shot.audioBinding &&
    typeof shot.audioBinding === 'object' &&
    !Array.isArray(shot.audioBinding)
      ? shot.audioBinding as Record<string, unknown>
      : null
  if (binding?.unitId !== target.sourceUnitId) {
    errors.push(`shots.0.audioBinding.unitId 必须为 ${target.sourceUnitId}`)
  }
  return errors
}

async function prepareIngestResult(
  context: DirectorStageContext,
  scriptUnits: ScriptUnit[],
  dependencies: StageResultDependencies
): Promise<PreparedStageResult> {
  const narration = await dependencies.synthesizeNarration({
    projectId: context.projectId,
    nodeId: context.nodeId,
    units: scriptUnits.map(({ unitId, text }) => ({ unitId, text })),
  })
  const audioManifest = buildMeasuredAudioManifest(scriptUnits, narration)
  const audioAllocation = buildMeasuredAudioAllocation(scriptUnits, audioManifest)
  return {
    content: JSON.stringify({ scriptUnits, audioManifest, audioAllocation }),
    ingestShots: scriptUnits.map((unit, index) => ({
      shotId: shotIdFor(index),
      sourceUnit: unit,
    })),
  }
}

/** 真实 TTS 只在服务端可用；动态导入避免把 server-only 拉进纯归一化路径。 */
function defaultDependencies(): StageResultDependencies {
  return {
    synthesizeNarration: async (input) => {
      const { synthesizeNarration } = await import('@/features/audio/narration')
      return synthesizeNarration(input)
    },
  }
}

function parseDirectOutput(content: string): { masterPlan: string; styleBible: string } {
  const trimmed = content.trim()
  const styleRegex = /(?:^|\n)\s*#*\s*STYLE[_\s]?BIBLE\s*(?::|——|-)?\s*\n/i
  const styleMatch = trimmed.match(styleRegex)
  const beforeStyle = styleMatch ? trimmed.slice(0, styleMatch.index).trim() : trimmed
  const afterStyle = styleMatch
    ? trimmed.slice(styleMatch.index! + styleMatch[0].length).trim()
    : ''
  const masterRegex = /(?:^|\n)\s*#*\s*MASTER[_\s]?PLAN\s*(?::|——|-)?\s*\n/i
  const masterMatch = beforeStyle.match(masterRegex)
  const masterPlan = masterMatch
    ? beforeStyle.slice(masterMatch.index! + masterMatch[0].length).trim()
    : beforeStyle
  const styleBible = afterStyle || masterPlan
  return {
    masterPlan: masterPlan || trimmed,
    styleBible: styleBible || masterPlan || trimmed,
  }
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim()
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('INGEST 输出不是 JSON 对象')
  return JSON.parse(unfenced.slice(start, end + 1)) as unknown
}

function stableSeed(...parts: string[]): number {
  return Number.parseInt(
    createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 8),
    16
  )
}
