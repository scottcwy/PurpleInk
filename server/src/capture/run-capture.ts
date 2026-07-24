// M3 编排器：串起「Firenze 实时采集 → Capture 适配器」。
//   createDriver → launch → 抓品牌 tokens → resolveCredentials → AiCaptureAgent.capture
//   → runCaptureAdapter 写出 HyperFrames 官方 capture/ 目录。
// 供 CLI（scripts/capture-url.ts）与后续后端 API 复用。
import { runCaptureAdapter } from "../adapter"
import type { AdapterManifest, PageTokens, StepSnapshot } from "../adapter/types"
import { extractPageTokensInBrowser } from "../adapter/extract-page-tokens"
import { createDriver, type DriverType } from "./browser-driver"
import { AiCaptureAgent } from "./ai-capture-agent"
import { resolveCredentials } from "./credentials"
import { logger } from "../lib/logger"

export interface RunCaptureOptions {
  /** 项目 id（写进 meta.json）；缺省从 URL 主机名派生 */
  id?: string
  /** 项目展示名；缺省用页面标题 / URL */
  name?: string
  /** 产品一句话简介，帮 Agent 判断核心功能 */
  description?: string
  /** 输出目录（默认 <cwd>/capture） */
  outDir?: string
  /** 浏览器驱动：playwright（真实）| mock（无浏览器冒烟）；缺省读 BROWSER_DRIVER */
  driver?: DriverType
  /** 是否用 StepFun 视觉给截图写描述（默认 true，缺 key 自动降级） */
  useVision?: boolean
  /** 测试账号（提供则登录优先） */
  testEmail?: string
  testPassword?: string
  minScreenshots?: number
  maxScreenshots?: number
  /** Agent 最大决策步数（默认 14，冒烟/调试时可调小） */
  maxSteps?: number
  /** 是否有头（调试用），默认 headless */
  headful?: boolean
}

/**
 * 采集一个 URL，产出 HyperFrames 官方 capture/ 目录。
 * @returns 写盘清单（含各资产描述）
 */
export async function runCapture(url: string, options: RunCaptureOptions = {}): Promise<AdapterManifest> {
  const driver = await createDriver(options.driver)
  await driver.launch({ headless: !options.headful })

  // onSnapshot 回填的语义快照（index 与截图对齐），用于拼 visible-text.txt
  const snapshots: StepSnapshot[] = []
  let pageTokens: PageTokens | undefined

  try {
    // 1. 先落地首页抓品牌数据（落地页颜色/字体/CSS 变量最全）
    await driver.navigate(url)
    try {
      const tokens = await driver.evaluate(extractPageTokensInBrowser)
      if (tokens && typeof tokens.title === "string") {
        pageTokens = tokens
        logger.info("run_capture:page_tokens", {
          colors: tokens.colors?.length ?? 0,
          fonts: tokens.fonts?.length ?? 0,
          cssVars: tokens.cssVariables ? Object.keys(tokens.cssVariables).length : 0,
        })
      } else {
        logger.info("run_capture:page_tokens_empty", { note: "mock/无品牌数据，tokens.json 走下限" })
      }
    } catch (err) {
      logger.warn("run_capture:page_tokens_failed", { error: String(err) })
    }

    // 2. 解析凭据（提供账号→登录优先；配了 IMAP→自助注册；都没有→仅采集公开内容）
    const credentials = await resolveCredentials({
      testEmail: options.testEmail,
      testPassword: options.testPassword,
    })

    // 3. 实时采集
    const agent = new AiCaptureAgent(driver, {
      credentials: credentials ?? undefined,
      description: options.description,
      minScreenshots: options.minScreenshots,
      maxScreenshots: options.maxScreenshots,
      maxSteps: options.maxSteps,
      onSnapshot: (snap, index) => {
        snapshots[index] = {
          title: snap.title,
          url: snap.url,
          elements: snap.elements,
          textContent: snap.textContent,
        }
      },
    })
    const capture = await agent.capture(url)

    // 4. 适配器写盘
    const manifest = await runCaptureAdapter(
      {
        id: options.id ?? slugFromUrl(url),
        name: options.name ?? pageTokens?.title ?? url,
        capture,
        snapshots: snapshots.filter(Boolean),
        pageTokens,
      },
      { outDir: options.outDir, useVision: options.useVision }
    )

    logger.info("run_capture:done", {
      outDir: manifest.outDir,
      assets: manifest.assets.length,
      visionUsed: manifest.visionUsed,
    })
    return manifest
  } finally {
    await driver.close()
  }
}

/** 从 URL 主机名派生一个 slug 作为 project id */
function slugFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "")
    return host.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "capture"
  } catch {
    return "capture"
  }
}
