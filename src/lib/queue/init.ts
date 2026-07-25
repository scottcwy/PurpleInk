import 'server-only'
import { queue } from './index'
import { isPositiveInteger } from './in-process-queue'
import type { LaneQuotas } from './types'

/**
 * 初始化标志锚定到 globalThis：instrumentation.ts 与各 API 路由分处不同模块图时，
 * 共享同一 initialized / initializing 状态，避免各自 start() 出双消费循环（split-brain）。
 */
const globalStore = globalThis as unknown as {
  __cvcQueueInitialized?: boolean
  __cvcQueueInitializing?: Promise<void> | null
}

/** kind -> 覆盖其配额的环境变量名。仅登记有默认配额的 kind；未登记 kind 走固定为 1 的兜底通道，不接受 env 覆盖。 */
const LANE_QUOTA_ENV_KEYS: Record<string, string> = {
  'director-stage': 'CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY',
  'render-shot': 'CVC_QUEUE_RENDER_SHOT_CONCURRENCY',
}

/** 读取队列并发的 env 覆盖并做范围校验；非法值（非正整数）直接抛错，不静默回退默认值。 */
export function resolveLaneQuotas(
  env: Record<string, string | undefined> = process.env
): LaneQuotas {
  const overrides: LaneQuotas = {}
  for (const [kind, envKey] of Object.entries(LANE_QUOTA_ENV_KEYS)) {
    const raw = env[envKey]
    if (raw === undefined || raw.trim() === '') continue
    const parsed = Number(raw)
    if (!isPositiveInteger(parsed)) {
      throw new Error(
        `invalid ${envKey}: "${raw}" (must be a positive integer)`
      )
    }
    overrides[kind] = parsed
  }
  return overrides
}

/** 幂等地注册队列处理器并启动进程内队列。
 *
 * 在 dev 模式下 Next.js instrumentation 有时不会自动触发，
 * 因此 API 路由在首次请求时兜底调用本函数。
 */
export async function initQueue(): Promise<void> {
  if (globalStore.__cvcQueueInitialized) return
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    globalStore.__cvcQueueInitialized = true
    return
  }
  if (globalStore.__cvcQueueInitializing) return globalStore.__cvcQueueInitializing
  globalStore.__cvcQueueInitializing = (async () => {
    const [directorMod, renderMod] = await Promise.all([
      import('@/features/director/queue-handler'),
      import('@/features/render/queue-handler'),
    ])
    if (typeof directorMod.registerDirectorStageHandler === 'function') {
      directorMod.registerDirectorStageHandler(queue)
    }
    if (typeof renderMod.registerRenderShotHandler === 'function') {
      renderMod.registerRenderShotHandler(queue)
    }
    queue.start(resolveLaneQuotas())
    globalStore.__cvcQueueInitialized = true
  })()
  return globalStore.__cvcQueueInitializing
}
