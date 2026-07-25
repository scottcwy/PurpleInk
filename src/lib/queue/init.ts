import 'server-only'
import { queue } from './index'

/**
 * 初始化标志锚定到 globalThis：instrumentation.ts 与各 API 路由分处不同模块图时，
 * 共享同一 initialized / initializing 状态，避免各自 start() 出双消费循环（split-brain）。
 */
const globalStore = globalThis as unknown as {
  __cvcQueueInitialized?: boolean
  __cvcQueueInitializing?: Promise<void> | null
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
    queue.start()
    globalStore.__cvcQueueInitialized = true
  })()
  return globalStore.__cvcQueueInitializing
}
