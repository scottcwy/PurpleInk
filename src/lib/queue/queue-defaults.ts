import os from 'node:os'

export const DEFAULT_DIRECTOR_STAGE_CONCURRENCY = 12
export const DEFAULT_AUDIO_TRANSCRIPTION_CONCURRENCY = 1
export const DEFAULT_WEBSITE_VIDEO_CONCURRENCY = 1

export function defaultRenderShotConcurrency(): number {
  // 容器 cgroup 限额下 cpus() 会高估；availableParallelism 更贴近真实可用并行度。
  return Math.min(8, Math.max(1, os.availableParallelism()))
}

export function defaultQueueLaneQuotas(): Record<string, number> {
  return {
    'director-stage': DEFAULT_DIRECTOR_STAGE_CONCURRENCY,
    'render-shot': defaultRenderShotConcurrency(),
    'audio-transcription': DEFAULT_AUDIO_TRANSCRIPTION_CONCURRENCY,
    'website-video': DEFAULT_WEBSITE_VIDEO_CONCURRENCY,
  }
}
