import 'server-only'
import { queue } from './index'
import { isPositiveInteger } from './in-process-queue'
import { loadLaneQuotasForStart } from './runtime-config'
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

/**
 * 读取队列并发的 env 覆盖并做范围校验；非法值（非正整数）直接抛错，不静默回退默认值。
 *
 * 该函数只负责 env 通道；DB 覆盖比 env 优先（ISSUE-011），由
 * `runtime-config.ts` 的 `loadLaneQuotasForStart()` 在启动时合并后传入 `queue.start()`。
 * 本出口仍保留同步签名，让单测可独立覆盖 env 解析而不必触达 DB。
 */
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
 * 首选启动点是 `src/instrumentation.ts`（进程启动即消费，不依赖 HTTP 请求）；
 * dev 模式下 Next.js instrumentation 有时不会自动触发，
 * 因此 API 路由在首次请求时兜底调用本函数。
 *
 * 启动失败（如 DB 未就绪）时重置 initializing 锚点，不缓存 rejected promise；
 * 否则 instrumentation 首跑失败会永久毒化兜底重试，只能重启进程。
 *
 * 启动期的 lane 配额按 **DB > env > 代码默认** 合并（ISSUE-011 单真值原则）。
 * 保存到 DB 的新配额需重启 dev 进程才会接管 `InProcessQueue.lanes`——
 * UI 直接同步标注「重启后生效」，不让用户以为已热生效。
 */
export async function initQueue(): Promise<void> {
  if (globalStore.__cvcQueueInitialized) return
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    globalStore.__cvcQueueInitialized = true
    return
  }
  if (globalStore.__cvcQueueInitializing) return globalStore.__cvcQueueInitializing
  globalStore.__cvcQueueInitializing = (async () => {
    try {
      const [directorMod, renderMod, exportMod, mediaMod, lanes] = await Promise.all([
        import('@/features/director/queue-handler'),
        import('@/features/render/queue-handler'),
        import('@/features/render/export-queue-handler'),
        import('@/features/audio/narration-queue-handler'),
        loadLaneQuotasForStart(),
      ])
      if (typeof directorMod.registerDirectorStageHandler === 'function') {
        directorMod.registerDirectorStageHandler(queue)
      }
      if (typeof renderMod.registerRenderShotHandler === 'function') {
        renderMod.registerRenderShotHandler(queue)
      }
      if (typeof exportMod.registerExportProjectHandler === 'function') {
        exportMod.registerExportProjectHandler(queue)
      }
      if (typeof mediaMod.registerMediaNarrationHandler === 'function') {
        mediaMod.registerMediaNarrationHandler(queue)
      }
      queue.start(lanes)
      globalStore.__cvcQueueInitialized = true
    } catch (error) {
      globalStore.__cvcQueueInitializing = null
      throw error
    }
  })()
  return globalStore.__cvcQueueInitializing
}
