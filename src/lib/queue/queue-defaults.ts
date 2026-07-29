import os from 'node:os'

export const DEFAULT_DIRECTOR_STAGE_CONCURRENCY = 12

export function defaultRenderShotConcurrency(): number {
  // 容器 cgroup 限额下 cpus() 会高估；availableParallelism 更贴近真实可用并行度。
  return Math.min(8, Math.max(1, os.availableParallelism()))
}
