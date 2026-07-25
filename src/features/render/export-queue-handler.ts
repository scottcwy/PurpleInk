import 'server-only'
import { z } from 'zod'
import { queue as defaultQueue, type QueueAdapter } from '@/lib/queue'
import { exportProject } from './export-service'

/**
 * 成片导出的队列接线。
 *
 * 为什么必须入队而不是在请求内直接跑：
 * `registerFinalArtifact` 按 `aggregateType: 'project'` 提交 final-mp4，产物提交
 * 需要一个项目级 running attempt。只有 `queue.enqueue`（不传 nodeId 时）会创建
 * `entityType: 'project'` 的 attempt——生产路径此前无人使用这个分支，导致导出必然
 * 在 ffmpeg 拼接完成后才抛「找不到可归属的 task attempt」，算力全部白烧。
 *
 * 顺带解决的问题：ffmpeg 拼接不再占用 Next 请求线程；`export-project` 未登记 lane
 * 配额，落入固定并发 1 的兜底通道，对 CPU 密集的拼接正好是期望语义。
 */

export const EXPORT_PROJECT_KIND = 'export-project'

const exportJobPayloadSchema = z
  .object({ projectId: z.string().min(1) })
  .strict()

export type ExportProjectInput = z.infer<typeof exportJobPayloadSchema>

interface ExportHandlerDependencies {
  exportProject: typeof exportProject
}

export function registerExportProjectHandler(
  targetQueue: QueueAdapter = defaultQueue,
  dependencies: ExportHandlerDependencies = { exportProject }
): void {
  targetQueue.register(EXPORT_PROJECT_KIND, async (job) => {
    const payload = exportJobPayloadSchema.parse(job.payload)
    const result = await dependencies.exportProject(payload.projectId)
    if (!result.ok) {
      throw new Error(
        `终片导出失败：以下节点尚未产出可用分镜 ${result.incompleteNodeIds.join('、')}`
      )
    }
  })
}

/** 入队一次项目级导出，返回可用于 `GET /api/jobs/{id}` 轮询的 jobId。 */
export async function enqueueProjectExport(
  input: ExportProjectInput,
  targetQueue: QueueAdapter = defaultQueue
): Promise<string> {
  const payload = exportJobPayloadSchema.parse(input)
  // 不传 nodeId：导出的聚合是项目本身，attempt 必须是 project 级。
  return targetQueue.enqueue(EXPORT_PROJECT_KIND, payload, {
    projectId: payload.projectId,
  })
}
