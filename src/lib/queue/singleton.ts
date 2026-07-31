import 'server-only'
import { InProcessQueue } from './in-process-queue'

/**
 * 进程内队列单例（本步不自动 start）。
 * 锚定到 globalThis，避免 Next.js HMR / 多路由模块图各自持有队列而形成双消费。
 * 独立于公开 index，保证启动入口不会连带加载查询与数据库模块图。
 */
const globalStore = globalThis as unknown as { __cvcQueue?: InProcessQueue }

export const queue: InProcessQueue = (
  globalStore.__cvcQueue ??= new InProcessQueue()
)
