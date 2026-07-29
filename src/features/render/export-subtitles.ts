import 'server-only'
import { z } from 'zod'
import {
  buildAssDocument,
  normalizeSubtitleTrackWithWholeClipFallback,
} from '@/features/audio/subtitle-ass'
import type { StorageAdapter } from '@/lib/storage'
import type { MediaAssemblyPlan } from './media-assembly'

/**
 * 成片硬字幕 ASS 构建（正常与降级导出共用）。
 *
 * 抽到独立模块是为了让 `export-service`（正常导出）与 `export-degraded`（降级导出）
 * 复用同一份字幕逻辑而不产生环依赖：降级占位镜头（`subtitle=null`）以一条「占位」
 * 提示 cue 顶替，保持时间轴偏移与其它镜头对齐，同时诚实标注该段为占位。
 */

const subtitleTrackSchema = z
  .object({
    shotId: z.string().min(1),
    sourceText: z.string().min(1),
    captions: z.array(
      z.object({
        text: z.string(),
        startMs: z.number(),
        endMs: z.number(),
      })
    ),
  })
  .passthrough()

export async function buildSubtitleAss(
  plan: MediaAssemblyPlan,
  storage: StorageAdapter
): Promise<string> {
  const shots = await Promise.all(
    plan.shots.map(async (shot) => {
      if (!shot.subtitle) return placeholderAssShot(shot, plan.fps)
      let parsed: z.infer<typeof subtitleTrackSchema>
      try {
        parsed = subtitleTrackSchema.parse(
          JSON.parse(
            (await storage.get(shot.subtitle.storageKey)).toString('utf-8')
          ) as unknown
        )
      } catch {
        throw new Error(`分镜 ${shot.laneKey} 的字幕产物无效`)
      }
      if (parsed.shotId !== shot.laneKey) {
        throw new Error(`分镜 ${shot.laneKey} 的字幕 lane 不匹配`)
      }
      return {
        laneKey: shot.laneKey,
        durationInFrames: shot.durationInFrames,
        sourceText: parsed.sourceText,
        audioDurationMs: shot.narration.endInUnitMs,
        captions: parsed.captions,
        precomputedCues: normalizeSubtitleTrackWithWholeClipFallback({
          sourceText: parsed.sourceText,
          audioDurationMs: shot.narration.endInUnitMs,
          captions: parsed.captions,
        }),
      }
    })
  )
  return buildAssDocument({
    fps: plan.fps,
    targetResolution: plan.targetResolution,
    shots,
  })
}

/** 占位镜头的字幕：一条贯穿整镜时长的「{lane} · 占位」提示，跳过 ASR↔原稿校验。 */
function placeholderAssShot(
  shot: MediaAssemblyPlan['shots'][number],
  fps: number
) {
  const durationMs = Math.round((shot.durationInFrames / fps) * 1_000)
  const text = `${shot.laneKey} · 占位`
  return {
    laneKey: shot.laneKey,
    durationInFrames: shot.durationInFrames,
    sourceText: text,
    audioDurationMs: durationMs,
    captions: [],
    precomputedCues: [{ startMs: 0, endMs: durationMs, text, lines: [text] }],
  }
}
