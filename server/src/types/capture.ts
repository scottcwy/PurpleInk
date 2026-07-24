// Capture 适配器的输入契约。
// 上半部分从 Firenze frameproof/src/types/capture.ts 原样拷贝；
// 下半部分（AiAction / CapturedScreenshot / CaptureResult）从 ai-capture-agent.ts 拷贝。
// 这些类型定义了「① 采集 Agent 产物」——即 ② 适配器要消费的东西。

export type PageType = "auth" | "product" | "marketing" | "onboarding"
export type CaptureMode = "auth" | "capture"

/** 浏览器启动参数 */
export interface LaunchOptions {
  headless?: boolean
  viewport?: { width: number; height: number }
  sessionState?: string
}

/** 截图元数据（采集时由 Agent 附带，用于分镜过滤与叙事增强） */
export interface ScreenshotMetadata {
  pageUrl?: string
  pageType?: PageType
  authWallSeen?: boolean
  aiDecision?: string
  captureMode?: CaptureMode
}

/** 语义快照：把页面「翻译」成结构化元素 + 可见文字 */
export interface SemanticSnapshot {
  title: string
  /** 当前页面 URL（用于判断导航/登录是否成功） */
  url?: string
  elements: Array<{
    /** 稳定引用编号，对应 DOM 上的 data-fp-ref 属性；供 Agent 回传定位元素 */
    ref: number
    tag: string
    role: string
    text: string
    /** input 类型（email/password/text/checkbox...），用于区分表单字段 */
    type?: string
    /** 表单字段 name 属性 */
    name?: string
    /** 输入框占位文本 */
    placeholder?: string
    selector: string
    bounds: { x: number; y: number; width: number; height: number }
  }>
  textContent: string
}

/** LLM 返回的动作结构 */
export interface AiAction {
  action: "click" | "fill" | "scroll" | "screenshot" | "navigate" | "press_key" | "verify_email" | "done"
  /** 目标元素引用编号（来自 snapshot 的 ref），click/fill 使用 */
  ref?: number
  /** 兜底选择器（当没有合适 ref 时） */
  selector?: string
  /** 值：fill 内容（支持占位符）/ scroll 方向 / navigate URL / press_key 按键 */
  value?: string
  label?: string
  reason?: string
  /** LLM 看图判断的登录状态 */
  loggedIn?: boolean
}

/** 单张采集截图（Agent 产物的基本单元） */
export interface CapturedScreenshot {
  buffer: Buffer
  label: string
  metadata: ScreenshotMetadata
}

/** 采集 Agent 的最终产物 —— 这就是 Capture 适配器的输入 */
export interface CaptureResult {
  screenshots: CapturedScreenshot[]
  actions: AiAction[]
  /** 元素级抠图：透明底 PNG，用于素材提取 */
  cutouts?: Array<{ name: string; buffer: Buffer }>
}
