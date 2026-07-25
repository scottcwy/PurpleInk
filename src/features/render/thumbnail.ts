import 'server-only'
import { createHash } from 'node:crypto'
import { openFrameCapture, type FrameCaptureOptions, type FrameCaptureSession } from './frame-capture'
import { RenderRepository } from './repository'
import { storage as defaultStorage, type StorageAdapter } from '@/lib/storage'
import { thumbnailOutputPath } from './types'
import type {
  FrameSpec,
  ThumbnailArtifactRecord,
  ThumbnailContext,
  ThumbnailResult,
  ThumbnailTarget,
} from './types'

export { FRAME_THUMBNAIL_KIND, thumbnailOutputPath } from './types'
export type {
  ThumbnailArtifactRecord,
  ThumbnailContext,
  ThumbnailResult,
  ThumbnailTarget,
} from './types'

interface ThumbnailRepositoryPort {
  findThumbnail(
    projectId: string,
    nodeId: string,
    sourceKey: string,
    frame: number
  ): Promise<ThumbnailArtifactRecord | null>
  registerThumbnail(input: {
    projectId: string
    nodeId: string
    outputKey: string
    contentHash: string
    sizeBytes: number
  }): Promise<string>
}

export interface ThumbnailDependencies {
  storage: StorageAdapter
  repository: ThumbnailRepositoryPort
  openCapture: (
    htmlPath: string,
    options?: FrameCaptureOptions
  ) => Promise<FrameCaptureSession>
}

function defaultDependencies(): ThumbnailDependencies {
  return {
    storage: defaultStorage,
    repository: new RenderRepository(),
    openCapture: openFrameCapture,
  }
}

/**
 * 缩略图缓存寻址键：由 HTML 实体 + 帧规格派生，任一变化都会产生不同 key，
 * 避免误命中旧图（镜像 renderer.ts 的 renderHash 语义）。
 */
export function thumbnailSourceKey(html: Buffer, frames: FrameSpec): string {
  return createHash('sha256')
    .update('cvc-thumbnail-v1\0')
    .update(html)
    .update('\0')
    .update(JSON.stringify(frames))
    .digest('hex')
}

/** [0, 1] 时间百分比 → 有效帧号，0% → 0，100% → 最后一帧，四舍五入取整。 */
export function fractionToFrame(fraction: number, durationInFrames: number): number {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new Error(`fraction 必须在 [0, 1] 区间：${fraction}`)
  }
  if (!Number.isInteger(durationInFrames) || durationInFrames < 1) {
    throw new Error(`durationInFrames 必须是正整数：${durationInFrames}`)
  }
  return Math.round(fraction * (durationInFrames - 1))
}

/**
 * 给定可信的 shot 渲染上下文 + 目标百分比数组，产出并登记对应静态帧 PNG。
 * 按需生成 + 持久缓存：命中已登记 artifact 的帧不会重新截图；未命中的帧
 * 只打开一次 capture session，按帧号顺序串行截取后统一关闭。
 */
export async function captureThumbnails(
  context: ThumbnailContext,
  targets: readonly ThumbnailTarget[],
  dependencies: Partial<ThumbnailDependencies> = {}
): Promise<ThumbnailResult[]> {
  const deps = { ...defaultDependencies(), ...dependencies }
  const html = await deps.storage.get(context.htmlKey)
  const sourceKey = thumbnailSourceKey(html, context.frames)

  const plan = targets.map((target) => ({
    fraction: target.fraction,
    frame: fractionToFrame(target.fraction, context.frames.durationInFrames),
  }))

  const recordByFrame = new Map<
    number,
    { artifactId: string; contentHash: string }
  >()
  const missingFrames: number[] = []
  for (const item of plan) {
    if (recordByFrame.has(item.frame)) continue
    const existing = await deps.repository.findThumbnail(
      context.projectId,
      context.nodeId,
      sourceKey,
      item.frame
    )
    if (existing && (await deps.storage.exists(existing.path))) {
      recordByFrame.set(item.frame, {
        artifactId: existing.artifactId,
        contentHash: existing.contentHash,
      })
    } else {
      missingFrames.push(item.frame)
    }
  }

  if (missingFrames.length > 0) {
    const captured = await captureMissingFrames(context, sourceKey, missingFrames, deps)
    for (const [frame, record] of captured) {
      recordByFrame.set(frame, record)
    }
  }

  return plan.map((item) => {
    const record = recordByFrame.get(item.frame)
    if (!record) throw new Error(`第 ${item.frame} 帧缩略图未生成`)
    return {
      fraction: item.fraction,
      frame: item.frame,
      artifactId: record.artifactId,
      contentHash: record.contentHash,
    }
  })
}

async function captureMissingFrames(
  context: ThumbnailContext,
  sourceKey: string,
  frames: readonly number[],
  deps: ThumbnailDependencies
): Promise<Map<number, { artifactId: string; contentHash: string }>> {
  const orderedFrames = [...new Set(frames)].sort((left, right) => left - right)
  const results = new Map<number, { artifactId: string; contentHash: string }>()
  const session = await deps.openCapture(deps.storage.localPath(context.htmlKey), {
    width: context.frames.width,
    height: context.frames.height,
  })
  try {
    for (const frame of orderedFrames) {
      const png = await session.capture(frame, context.frames.fps)
      const contentHash = createHash('sha256').update(png).digest('hex')
      const outputKey = thumbnailOutputPath(
        context.projectId,
        context.nodeId,
        sourceKey,
        frame
      )
      await deps.storage.put(outputKey, png)
      try {
        const artifactId = await deps.repository.registerThumbnail({
          projectId: context.projectId,
          nodeId: context.nodeId,
          outputKey,
          contentHash,
          sizeBytes: png.byteLength,
        })
        results.set(frame, { artifactId, contentHash })
      } catch (error) {
        await deps.storage.delete(outputKey)
        throw error
      }
    }
  } finally {
    await session.close()
  }
  return results
}
