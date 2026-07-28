import 'server-only'
import { z } from 'zod'
import {
  getJobSnapshot,
  queue as defaultQueue,
  type JobSnapshot,
  type QueueAdapter,
} from '@/lib/queue'
import { exportProject } from './export-service'
import { exportDegradedProject } from './export-degraded'
import { RenderRepository } from './repository'
import { assertProjectWorkflowSupported } from '@/features/projects/project-compatibility'

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
  .object({ projectId: z.string().min(1), degraded: z.boolean().optional() })
  .strict()

export type ExportProjectInput = z.infer<typeof exportJobPayloadSchema>

interface ExportHandlerDependencies {
  exportProject: typeof exportProject
  exportDegradedProject: typeof exportDegradedProject
}

export function registerExportProjectHandler(
  targetQueue: QueueAdapter = defaultQueue,
  dependencies: ExportHandlerDependencies = {
    exportProject,
    exportDegradedProject,
  }
): void {
  targetQueue.register(EXPORT_PROJECT_KIND, async (job) => {
    const payload = exportJobPayloadSchema.parse(job.payload)
    // 降级导出只由用户显式触发（payload.degraded）；自动推进不传该标志。
    const result = payload.degraded
      ? await dependencies.exportDegradedProject(payload.projectId, {
          repository: new RenderRepository(),
        })
      : await dependencies.exportProject(payload.projectId)
    if (!result.ok) {
      const mediaIssue = result.blockingIssues?.[0]
      if (mediaIssue) {
        const target = mediaIssue.laneKey ?? '项目'
        const media =
          mediaIssue.kind === 'narration'
            ? '旁白'
            : mediaIssue.kind === 'subtitle'
              ? '字幕'
              : '渲染'
        const reason =
          mediaIssue.code === 'artifact-invalid'
            ? '产物无效'
            : mediaIssue.code === 'artifact-missing'
              ? '产物缺失'
              : '节点未完成'
        const prefix = payload.degraded ? '降级导出失败' : '终片导出失败'
        throw new Error(`${prefix}：${target} ${media}${reason}`)
      }
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
  if (targetQueue === defaultQueue) {
    await assertProjectWorkflowSupported(payload.projectId)
  }
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
