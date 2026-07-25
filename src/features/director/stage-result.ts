import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  MASTER_RESOLUTION_PRESET,
  resolutionForPreset,
  type ShotLaneSeed,
} from '@/features/canvas/contracts'
import { fabricatePromptInputSchema } from './prompts/fabricate'
import { buildDemoAudioAllocation, buildDemoAudioManifest } from './audio-demo'
import { ingestStageResultSchema } from './schemas/ingest'
import { directorShotPlanSchema } from './schemas/director-shot-plan'
import type { DirectorStageContext } from './runtime-repository'

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

/** 将不可信模型文本归一化为可提交的阶段结果。 */
export function prepareStageResult(
  context: DirectorStageContext,
  rawContent: string
): PreparedStageResult {
  if (context.stage === 'INGEST') {
    const parsed = ingestStageResultSchema.parse(parseJsonObject(rawContent))
    const audioManifest = buildDemoAudioManifest(parsed.scriptUnits)
    const audioAllocation = buildDemoAudioAllocation(parsed.scriptUnits, audioManifest)
    return {
      content: JSON.stringify({
        scriptUnits: parsed.scriptUnits,
        audioManifest,
        audioAllocation,
      }),
      ingestShots: parsed.scriptUnits.map((unit, index) => ({
        shotId: `S${String(index + 1).padStart(3, '0')}`,
        sourceUnit: unit,
      })),
    }
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
    return { content: JSON.stringify(parsed) }
  }

  return { content: rawContent }
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
