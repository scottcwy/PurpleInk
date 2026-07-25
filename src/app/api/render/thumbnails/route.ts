import { NextResponse } from 'next/server'
import { getCanvasGraph } from '@/features/canvas'
import { captureThumbnails, RenderRepository } from '@/features/render'

export const dynamic = 'force-dynamic'

/** 缩略图轨道的 8 个等距时间点：0, 1/7, …, 1（含首尾帧）。 */
const THUMBNAIL_FRACTIONS = Array.from({ length: 8 }, (_, index) => index / 7)

/**
 * 按需生成并返回某个已渲染分镜的静态帧缩略图。
 * 只回传 artifact id 下载 URL，绝不暴露 StorageAdapter key 或本机绝对路径；
 * 底层的截帧与缓存由 issue-04 的 `captureThumbnails` 负责（本路由只消费）。
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const projectId = url.searchParams.get('projectId')
  const nodeId = url.searchParams.get('nodeId')
  if (!projectId || !nodeId) {
    return NextResponse.json(
      { ok: false, error: '缺少 projectId 或 nodeId' },
      { status: 400 }
    )
  }
  const graph = await getCanvasGraph(projectId)
  if (!graph.nodes.some((node) => node.id === nodeId)) {
    return NextResponse.json(
      { ok: false, error: '节点不存在或不属于该项目' },
      { status: 404 }
    )
  }
  try {
    const repository = new RenderRepository()
    const context = await repository.loadCompletedThumbnailContext(
      projectId,
      nodeId
    )
    const results = await captureThumbnails(
      context,
      THUMBNAIL_FRACTIONS.map((fraction) => ({ fraction }))
    )
    return NextResponse.json({
      ok: true,
      thumbnails: results.map((result) => ({
        fraction: result.fraction,
        url: `/api/artifacts/${result.artifactId}?projectId=${encodeURIComponent(projectId)}`,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: messageOf(error) },
      { status: 409 }
    )
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '缩略图生成失败'
}
