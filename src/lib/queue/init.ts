import 'server-only'

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
      const [
        queueMod,
        directorMod,
        renderMod,
        exportMod,
        mediaMod,
        transcriptionMod,
        websiteMod,
        lanes,
      ] = await Promise.all([
        import('./singleton'),
        import('@/features/director/queue-handler'),
        import('@/features/render/queue-handler'),
        import('@/features/render/export-queue-handler'),
        import('@/features/audio/narration-queue-handler'),
        import('@/features/audio/audio-transcription-queue-handler'),
        import('@/features/website/website-queue-handler'),
        import('./runtime-config').then(
          ({ loadLaneQuotasForStart }) => loadLaneQuotasForStart(),
        ),
      ])
      const { queue } = queueMod
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
      if (
        typeof transcriptionMod.registerAudioTranscriptionHandler === 'function'
      ) {
        transcriptionMod.registerAudioTranscriptionHandler(queue)
      }
      if (typeof websiteMod.registerWebsiteVideoHandler === 'function') {
        websiteMod.registerWebsiteVideoHandler(queue)
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
