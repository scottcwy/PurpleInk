import 'server-only'

/** 阶段失败结构化错误（与 canvas_nodes.data.directorError 同构）。 */
export interface StreamError {
  stage: string
  message: string
}

/** 某个流的即时快照（供新订阅者回放 + 服务端落盘取全文）。 */
export interface StreamSnapshot {
  text: string
  done: boolean
  error?: StreamError
  truncated: boolean
}

/** 订阅者收到的事件：先 snapshot，再增量 delta，最后 done / error。 */
export type StreamEvent =
  | ({ type: 'snapshot' } & StreamSnapshot)
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; error: StreamError }

type Listener = (event: StreamEvent) => void

/** 单键内存缓冲上限：超出丢弃最旧并置 truncated，避免长流打爆内存。 */
const MAX_BUFFER_CHARS = 256 * 1024
/** 末位订阅者断开后保留缓冲的窗口，给刷新 / 短暂重连留回放余量。 */
const CLEANUP_DELAY_MS = 30_000

interface Entry {
  text: string
  done: boolean
  error?: StreamError
  truncated: boolean
}

/**
 * 进程内流式事件总线：以 `${projectId}:${nodeId}` 为键，累积 AI 逐 token
 * 输出到有界内存缓冲，并向订阅者广播 snapshot / delta / done / error。
 *
 * 纯内存基础设施，不触碰 DB / storage（持久化由 Director 层负责）。
 * 单进程 Demo 足够；多实例部署需替换为 Redis pub/sub（后置）。
 */
export class StreamBus {
  private readonly entries = new Map<string, Entry>()
  /** 订阅者独立于缓冲 entry 维护：subscribe 这个只读动作绝不创建 entry。 */
  private readonly listeners = new Map<string, Set<Listener>>()

  private ensure(key: string): Entry {
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { text: '', done: false, truncated: false }
      this.entries.set(key, entry)
    }
    return entry
  }

  /** 是否存在该键的缓冲（活跃或刚结束未清理）。 */
  has(key: string): boolean {
    return this.entries.has(key)
  }

  /** 是否有进行中的活跃流（已建缓冲且未结束）。 */
  isActive(key: string): boolean {
    const entry = this.entries.get(key)
    return !!entry && !entry.done
  }

  /** 追加一段增量并广播。若上一轮已结束则视为新一轮，先重置。 */
  publish(key: string, delta: string): void {
    if (!delta) return
    const entry = this.ensure(key)
    if (entry.done) this.resetEntry(entry)
    entry.text += delta
    if (entry.text.length > MAX_BUFFER_CHARS) {
      entry.text = entry.text.slice(entry.text.length - MAX_BUFFER_CHARS)
      entry.truncated = true
    }
    this.emit(key, { type: 'delta', text: delta })
  }

  /** 标记该键的流正常结束并广播 done。 */
  markDone(key: string): void {
    const entry = this.ensure(key)
    entry.done = true
    entry.error = undefined
    this.emit(key, { type: 'done' })
  }

  /** 标记该键的流失败并广播 error（随后视为结束）。 */
  markError(key: string, error: StreamError): void {
    const entry = this.ensure(key)
    entry.done = true
    entry.error = error
    this.emit(key, { type: 'error', error })
  }

  /** 读取即时快照（键不存在时返回空快照）。 */
  getSnapshot(key: string): StreamSnapshot {
    const entry = this.entries.get(key)
    if (!entry) return { text: '', done: false, truncated: false }
    return {
      text: entry.text,
      done: entry.done,
      error: entry.error,
      truncated: entry.truncated,
    }
  }

  /**
   * 订阅：先原子回放当前快照，再接收后续 delta / done / error。
   * 返回退订函数；末位订阅者断开且流已结束时延时清理缓冲。
   */
  subscribe(key: string, listener: Listener): () => void {
    const entry = this.entries.get(key)
    listener({
      type: 'snapshot',
      text: entry?.text ?? '',
      done: entry?.done ?? false,
      error: entry?.error,
      truncated: entry?.truncated ?? false,
    })
    const set = this.listeners.get(key) ?? new Set<Listener>()
    this.listeners.set(key, set)
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(key)
      this.maybeCleanup(key)
    }
  }

  /** 显式清空一轮（新 run 前可调用；publish-after-done 已自动重置）。 */
  reset(key: string): void {
    const entry = this.entries.get(key)
    if (entry) this.resetEntry(entry)
  }

  private resetEntry(entry: Entry): void {
    entry.text = ''
    entry.done = false
    entry.error = undefined
    entry.truncated = false
  }

  private emit(key: string, event: StreamEvent): void {
    const set = this.listeners.get(key)
    if (!set) return
    for (const listener of set) {
      try {
        listener(event)
      } catch {
        // 单个订阅者异常不影响其它订阅者与主流程。
      }
    }
  }

  private maybeCleanup(key: string): void {
    const set = this.listeners.get(key)
    if (set && set.size > 0) return
    const entry = this.entries.get(key)
    if (!entry || !entry.done) return
    const timer = setTimeout(() => {
      const listeners = this.listeners.get(key)
      const current = this.entries.get(key)
      if ((!listeners || listeners.size === 0) && current && current.done) {
        this.entries.delete(key)
      }
    }, CLEANUP_DELAY_MS)
    ;(timer as { unref?: () => void }).unref?.()
  }
}

/**
 * 进程内流式总线单例：锚定到 globalThis，避免 Next.js（Turbopack dev 按路由入口
 * 编译 + HMR 重新求值模块）下同一模块被多次求值、产生互不相通实例的 split-brain。
 */
const globalStore = globalThis as unknown as { __cvcStreamBus?: StreamBus }
export const streamBus: StreamBus = (globalStore.__cvcStreamBus ??= new StreamBus())
