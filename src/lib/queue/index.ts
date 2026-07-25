import 'server-only'
import { InProcessQueue } from './in-process-queue'

/**
 * 进程内队列单例（本步不自动 start；渲染步注册 handler 后再启动）。
 * 锚定到 globalThis，避免 Next.js HMR / 多路由模块图各自持一个队列实例（split-brain）。
 */
const globalStore = globalThis as unknown as { __cvcQueue?: InProcessQueue }
export const queue: InProcessQueue = (globalStore.__cvcQueue ??= new InProcessQueue())

export { InProcessQueue } from './in-process-queue'
export type { JobHandler, JobStatus, QueueAdapter, QueueJob } from './types'
export { getJobSnapshot, type JobSnapshot } from './query'
