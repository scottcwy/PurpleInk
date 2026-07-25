import 'server-only'

/**
 * 节点领域状态（与 `@/features/canvas` 的 `NodeStatus` 同形字面量联合）。
 * lib 层不反向依赖 features，故在此独立声明；结构一致由 TS 赋值兼容保证。
 */
export type NodeStatusValue =
  | 'idle'
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'stale'

/**
 * 订阅者收到的事件：订阅时先原子回放 snapshot（每节点最新状态 + 当前 seq 水位），
 * 之后接收 node-status（单节点 upsert）与 topology（节点/边集合变化，需重拉全图）。
 */
export type StatusBusEvent =
  | { type: 'snapshot'; seq: number; statuses: Record<string, NodeStatusValue> }
  | { type: 'node-status'; seq: number; nodeId: string; status: NodeStatusValue }
  | { type: 'topology'; seq: number }

type Listener = (event: StatusBusEvent) => void

/** 末位订阅者断开后保留状态缓冲的窗口，给刷新 / 短暂重连留回放余量。 */
const CLEANUP_DELAY_MS = 30_000

interface Entry {
  /** 项目内单调事件序号；进程生命周期内递增，entry 清理后从 0 重来。 */
  seq: number
  statuses: Map<string, NodeStatusValue>
}

/**
 * 进程内项目状态总线：以 projectId 为键，保存「每节点最新状态」的有界快照
 * （节点数天然有界），并向订阅者广播 node-status / topology 事件。
 *
 * 与 StreamBus（文本累积 append）语义不同：这里是最新值 upsert + 快照回放，
 * 重连订阅即通过 snapshot 完成状态对齐，无需增量回放协议。
 * 纯内存基础设施；单进程 Demo 足够，多实例部署需换 Redis pub/sub（后置，已登记）。
 */
export class StatusBus {
  private readonly entries = new Map<string, Entry>()
  /** 订阅者独立于缓冲 entry 维护：subscribe 这个只读动作绝不创建 entry。 */
  private readonly listeners = new Map<string, Set<Listener>>()

  private ensure(projectId: string): Entry {
    let entry = this.entries.get(projectId)
    if (!entry) {
      entry = { seq: 0, statuses: new Map() }
      this.entries.set(projectId, entry)
    }
    return entry
  }

  /** upsert 单节点最新状态并广播 node-status。 */
  publishStatus(
    projectId: string,
    nodeId: string,
    status: NodeStatusValue
  ): void {
    const entry = this.ensure(projectId)
    entry.seq += 1
    entry.statuses.set(nodeId, status)
    this.emit(projectId, {
      type: 'node-status',
      seq: entry.seq,
      nodeId,
      status,
    })
  }

  /** 节点/边集合发生变化（扇出等），订阅方需重拉全图。 */
  publishTopology(projectId: string): void {
    const entry = this.ensure(projectId)
    entry.seq += 1
    this.emit(projectId, { type: 'topology', seq: entry.seq })
  }

  /** 读取即时快照（键不存在时返回 seq 0 的空快照）。 */
  getSnapshot(projectId: string): {
    seq: number
    statuses: Record<string, NodeStatusValue>
  } {
    const entry = this.entries.get(projectId)
    return {
      seq: entry?.seq ?? 0,
      statuses: Object.fromEntries(entry?.statuses ?? []),
    }
  }

  /**
   * 订阅：先原子回放当前快照，再接收后续 node-status / topology。
   * 返回退订函数；末位订阅者断开后延时清理缓冲（seq 随之归零，
   * 客户端以每次连接的 snapshot 为基线，不跨连接比较 seq）。
   */
  subscribe(projectId: string, listener: Listener): () => void {
    const snapshot = this.getSnapshot(projectId)
    try {
      listener({ type: 'snapshot', ...snapshot })
    } catch {
      // 快照回放异常与 emit 同样容错，不影响订阅建立与其它订阅者。
    }
    const set = this.listeners.get(projectId) ?? new Set<Listener>()
    this.listeners.set(projectId, set)
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(projectId)
      this.maybeCleanup(projectId)
    }
  }

  private emit(projectId: string, event: StatusBusEvent): void {
    const set = this.listeners.get(projectId)
    if (!set) return
    for (const listener of set) {
      try {
        listener(event)
      } catch {
        // 单个订阅者异常不影响其它订阅者与主流程。
      }
    }
  }

  private maybeCleanup(projectId: string): void {
    const set = this.listeners.get(projectId)
    if (set && set.size > 0) return
    const timer = setTimeout(() => {
      const listeners = this.listeners.get(projectId)
      if (!listeners || listeners.size === 0) {
        this.entries.delete(projectId)
      }
    }, CLEANUP_DELAY_MS)
    ;(timer as { unref?: () => void }).unref?.()
  }
}

/**
 * 进程内状态总线单例：锚定到 globalThis，避免 Next.js（Turbopack dev 按路由入口
 * 编译 + HMR 重新求值模块）下同一模块被多次求值、产生互不相通实例的 split-brain。
 */
const globalStore = globalThis as unknown as { __cvcStatusBus?: StatusBus }
export const statusBus: StatusBus = (globalStore.__cvcStatusBus ??= new StatusBus())
