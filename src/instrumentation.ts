/**
 * Next.js instrumentation：服务器进程启动时初始化进程内队列（ISSUE-006）。
 *
 * 没有本文件时，队列只能靠 API 路由首次请求兜底启动——生产环境意味着
 * 「没人访问就不消费队列」。`initQueue()` 的 globalThis 锚定与各 API 路由
 * 的兜底调用共享同一初始化状态，不会出现双消费循环（split-brain）。
 *
 * 模块顶层保持零副作用：所有依赖在 register() 内动态 import，
 * 使 `@/instrumentation` 满足 runtime-boundary 的 import-safe 契约。
 */
export async function register(): Promise<void> {
  // 仅 Node.js 运行时启动队列；edge runtime 不承载进程内队列。
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // build 期的预渲染 worker 也会触发 register；此时启动 setInterval
  // 消费循环会挂住构建进程，且构建环境不保证 DB 可达。
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  const { initQueue } = await import('@/lib/queue/init')
  try {
    await initQueue()
  } catch (error) {
    // DB 未就绪等启动期失败不阻断 Next 启动；initQueue 失败后会重置
    // initializing 锚点，API 路由首次请求仍会兜底重试。
    console.error('[instrumentation] 队列启动失败，等待 API 路由兜底重试', error)
  }
}
