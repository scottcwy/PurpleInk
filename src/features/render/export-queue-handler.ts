import 'server-only'
import { z } from 'zod'
import {
  getJobSnapshot,
  queue as defaultQueue,
  type JobSnapshot,
  type QueueAdapter,
} from '@/lib/queue'
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

export interface AwaitExportDependencies {
  enqueue: (input: ExportProjectInput) => Promise<string>
  getJobSnapshot: (projectId: string, jobId: string) => Promise<JobSnapshot | null>
  wait: (milliseconds: number) => Promise<void>
  /** 轮询上限，防止无界等待；超时如实报出，不假装成功。 */
  maxPolls?: number
}

/**
 * 入队并等待成片导出完成。
 *
 * autopilot 走这里：FINALIZE 的 `export` 节点要消费 final-mp4，因此拼接必须先完成。
 * 等待发生在 director-stage 通道内，而导出作业落在独立的兜底通道，两条通道在
 * `tick()` 里并行 drain，不会互相饿死。
 */
export async function runProjectExport(
  projectId: string,
  dependencies?: AwaitExportDependencies
): Promise<void> {
  const resolved = dependencies ?? defaultAwaitDependencies()
  const jobId = await resolved.enqueue({ projectId })
  const maxPolls = resolved.maxPolls ?? DEFAULT_MAX_POLLS
  for (let poll = 0; poll < maxPolls; poll += 1) {
    const job = await resolved.getJobSnapshot(projectId, jobId)
    if (job?.status === 'done') return
    if (job?.status === 'failed') {
      throw new Error(job.error ?? '终片导出作业失败')
    }
    await resolved.wait(POLL_INTERVAL_MS)
  }
  throw new Error(`终片导出作业未在预期时间内完成：${jobId}`)
}

const POLL_INTERVAL_MS = 1_000
/** 30 分钟上限：足够长片拼接，又不会无界挂住调用方。 */
const DEFAULT_MAX_POLLS = 1_800

function defaultAwaitDependencies(): AwaitExportDependencies {
  return {
    enqueue: (input) => enqueueProjectExport(input),
    getJobSnapshot,
    wait: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }
}
