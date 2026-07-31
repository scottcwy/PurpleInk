import 'server-only'

/**
 * 进程内 Provider 熔断器（模式 H 阶段 4）。
 *
 * 每个 provider 独立计数：连续失败 ≥3 次即 open 5 分钟；窗口过后进入 half-open，
 * 只放行一次试探，成功即 close，失败则重新 open 一整个窗口。
 *
 * 记账的**单一收敛点**在 `pi-session.ts` 的 run 结果处：只有真实发生过的外部
 * 模型调用（PROVIDER_FAILED 一类）才计入；RouteContractError 等应用内部矛盾在
 * 会话装配阶段就已抛出，永远不会到达记账点（模式 B：内部矛盾不得贴外部标签）。
 *
 * 纯内存、无 DB 表——当前部署是单实例假设。若未来多实例部署，计数必须落库
 * （如 workspace_settings 或独立表）并带乐观锁，否则每个实例各自半开试探，
 * 熔断形同虚设。
 */

/** 连续失败阈值：达到即 open。 */
const FAILURE_THRESHOLD = 3
/** open 窗口时长：窗口内一律拒绝。 */
const OPEN_WINDOW_MS = 5 * 60_000
/**
 * half-open 试探名额的兜底时限：试探进程可能中断而永远不归还结论，
 * 名额若无时限，该 provider 会被一个悬挂的试探永久判为不可用。
 */
const PROBE_DEADLINE_MS = 60_000

interface BreakerState {
  /** 连续外部失败次数；成功即清零。 */
  consecutiveFailures: number
  /** open 截止时间戳；null 表示 closed。 */
  openedUntil: number | null
  /** half-open 试探名额的占用截止时间戳；null 表示名额空闲。 */
  probeUntil: number | null
}

/**
 * 状态锚定到 globalThis：dev HMR 会替换模块实例，模块级 Map 每次热更都清零，
 * 熔断计数随之丢失（与 `src/lib/queue/init.ts` 的幂等锚定同款手法）。
 */
const globalStore = globalThis as unknown as {
  __cvcProviderBreakers?: Map<string, BreakerState>
}

function breakers(): Map<string, BreakerState> {
  globalStore.__cvcProviderBreakers ??= new Map()
  return globalStore.__cvcProviderBreakers
}

function stateFor(providerId: string): BreakerState {
  const existing = breakers().get(providerId)
  if (existing) return existing
  const created: BreakerState = {
    consecutiveFailures: 0,
    openedUntil: null,
    probeUntil: null,
  }
  breakers().set(providerId, created)
  return created
}

/**
 * 该 provider 当前是否可用。
 *
 * 注意 half-open 语义：open 窗口过后**第一次**调用会占用唯一的试探名额并返回
 * true，后续调用在试探出结论（record*）或名额超时前一律返回 false。因此本函数
 * 只应在「即将真的发起调用」的路由解析处调用，不要用于纯展示。
 */
export function isProviderAvailable(providerId: string): boolean {
  const state = breakers().get(providerId)
  if (!state || state.openedUntil === null) return true
  const now = Date.now()
  if (now < state.openedUntil) return false
  if (state.probeUntil !== null && now < state.probeUntil) return false
  state.probeUntil = now + PROBE_DEADLINE_MS
  return true
}

/** 外部调用成功：清零计数并关闭熔断（half-open 试探成功即 close）。 */
export function recordProviderSuccess(providerId: string): void {
  const state = breakers().get(providerId)
  if (!state) return
  state.consecutiveFailures = 0
  state.openedUntil = null
  state.probeUntil = null
}

/**
 * 外部调用失败：只允许在已被分类为外部 provider 故障的收敛点调用。
 * 达到阈值（或 half-open 试探失败）即 open 一整个窗口。
 */
export function recordProviderFailure(providerId: string): void {
  const state = stateFor(providerId)
  state.consecutiveFailures += 1
  state.probeUntil = null
  if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
    state.openedUntil = Date.now() + OPEN_WINDOW_MS
  }
}

/** 测试用：复位单个 provider，或不带参数复位全部。 */
export function resetBreaker(providerId?: string): void {
  if (providerId === undefined) {
    breakers().clear()
    return
  }
  breakers().delete(providerId)
}
