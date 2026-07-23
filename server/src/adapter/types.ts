// Capture 适配器的输入/输出契约。
// 适配器把「① Firenze 采集产物」翻译成「HyperFrames 官方 capture/ 目录」。
import type { CaptureResult, SemanticSnapshot } from "../types/capture"

/**
 * 页面级品牌数据。
 * M3 由增强版 snapshot（在 playwright-driver 里补一段 getComputedStyle 采集，
 * 见 extract-page-tokens.ts）提供；缺省时 tokens.json 走「下限」字段。
 */
export interface PageTokens {
  title: string
  description?: string
  ogImage?: string
  /** 页面出现过的颜色（十六进制，大写），按出现频次降序 */
  colors?: string[]
  fonts?: Array<{
    family: string
    weights?: number[]
    variable?: boolean
    weightRange?: [number, number]
  }>
  /** 站点主题变量（shadcn 风 --primary/--background...），贴品牌的关键 */
  cssVariables?: Record<string, string>
  headings?: Array<{
    level: number
    text: string
    fontSize?: string
    fontWeight?: string
    color?: string
  }>
  ctas?: Array<{ text: string; href?: string }>
  /** 每种颜色的角色统计：bg/text/最大面积，供 Step2 判主色/背景色 */
  colorStats?: Array<{
    hex: string
    count?: number
    bgCount?: number
    interactiveBg?: number
    areaBg?: number
    textCount?: number
    maxArea?: number
  }>
  sections?: Array<Record<string, unknown>>
  page?: { width: number; height: number; viewport?: { width: number; height: number } }
}

/** 采集过程中每一步的语义快照（顺序 = 采集顺序），用于拼 visible-text.txt */
export type StepSnapshot = Pick<SemanticSnapshot, "title" | "url" | "elements" | "textContent">

/** 适配器的完整输入 */
export interface AdapterInput {
  /** 项目 id / 展示名（写进 meta.json） */
  id: string
  name: string
  /** Firenze 采集产物（截图 + 动作日志） */
  capture: CaptureResult
  /** 各步语义快照，用于生成 visible-text.txt */
  snapshots: StepSnapshot[]
  /** 页面品牌数据；缺省则 tokens.json 只写下限字段 */
  pageTokens?: PageTokens
}

export interface AdapterOptions {
  /** 用 StepFun 多模态给截图生成视觉级描述（默认 true；无 STEP_API_KEY 时自动降级为目录派生描述） */
  useVision?: boolean
  /** 输出目录（默认 <cwd>/capture） */
  outDir?: string
}

/** 单个资产的落盘记录 */
export interface WrittenAsset {
  /** 相对 capture/ 的路径，如 assets/00-dashboard.png */
  path: string
  label: string
  description: string
}

/** 适配器运行结果清单 */
export interface AdapterManifest {
  outDir: string
  assets: WrittenAsset[]
  files: string[]
  visionUsed: boolean
}
