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
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { writeFileSync } from "node:fs"

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
      ...(options.testEmail != null ? { testEmail: options.testEmail } : {}),
      ...(options.testPassword != null ? { testPassword: options.testPassword } : {}),
    })

    // 3. 根据页面导航项数量推断复杂度，动态调整最大步数
    let effectiveMaxSteps = options.maxSteps ?? 14
    if (!options.maxSteps) {
      try {
        const navCount = await driver.evaluate(() => {
          const nav = document.querySelectorAll(
            'nav a, header a, [role="navigation"] a, [role="menubar"] a'
          )
          // 去重（同一 href 只算一个）
          const seen = new Set<string>()
          nav.forEach((a) => {
            const href = (a as HTMLAnchorElement).href
            if (href) seen.add(href)
          })
          return seen.size
        })
        if (navCount < 5) effectiveMaxSteps = 8
        else if (navCount <= 15) effectiveMaxSteps = 14
        else effectiveMaxSteps = 18
        logger.info("run_capture:complexity", { navCount, maxSteps: effectiveMaxSteps })
      } catch {
        // 评估失败时保持默认
        logger.warn("run_capture:complexity_detect_failed", { fallback: effectiveMaxSteps })
      }
    }

    // 4. 实时采集
    const agent = new AiCaptureAgent(driver, {
      ...(credentials ? { credentials } : {}),
      ...(options.description != null ? { description: options.description } : {}),
      ...(options.minScreenshots != null ? { minScreenshots: options.minScreenshots } : {}),
      ...(options.maxScreenshots != null ? { maxScreenshots: options.maxScreenshots } : {}),
      maxSteps: effectiveMaxSteps,
      onSnapshot: (snap, index) => {
        snapshots[index] = {
          title: snap.title,
          url: snap.url || "",
          elements: snap.elements,
          textContent: snap.textContent,
        }
      },
    })
    const capture = await agent.capture(url)

    // 4b. 提取关键元素坐标布局
    let layoutData: Array<{ selector: string; x: number; y: number; w: number; h: number }> | undefined
    if (driver.extractLayout) {
      try {
        layoutData = await driver.extractLayout()
        logger.info("run_capture:layout_extracted", { elements: layoutData.length })
      } catch (err) {
        logger.warn("run_capture:layout_extract_failed", { error: String(err) })
      }
    }

    // 5. 适配器写盘
    const manifest = await runCaptureAdapter(
      {
        id: options.id ?? slugFromUrl(url),
        name: options.name ?? pageTokens?.title ?? url,
        capture,
        snapshots: snapshots.filter(Boolean),
        ...(pageTokens ? { pageTokens } : {}),
      },
      {
        ...(options.outDir != null ? { outDir: options.outDir } : {}),
        ...(options.useVision != null ? { useVision: options.useVision } : {}),
      }
    )

    // 5b. 写 layout.json + cutouts 到磁盘（不经过适配器，避免与 task #7 冲突）
    const captureOutDir = manifest.outDir
    try {
      if (layoutData && layoutData.length > 0) {
        const extractedDir = join(captureOutDir, "extracted")
        await mkdir(extractedDir, { recursive: true })
        await writeFile(join(extractedDir, "layout.json"), JSON.stringify(layoutData, null, 2), "utf8")
        logger.info("run_capture:layout_written")
      }
      if (capture.cutouts && capture.cutouts.length > 0) {
        const cutoutsDir = join(captureOutDir, "assets", "cutouts")
        await mkdir(cutoutsDir, { recursive: true })
        for (const cutout of capture.cutouts) {
          await writeFile(join(cutoutsDir, `${cutout.name}.png`), cutout.buffer)
        }
        logger.info("run_capture:cutouts_written", { count: capture.cutouts.length })
      }
    } catch (err) {
      logger.warn("run_capture:extra_write_failed", { error: String(err) })
    }

    // 5c. 提取并下载视频资源
    if (driver.extractVideoUrls) {
      try {
        const videoUrls = await driver.extractVideoUrls()
        const assetsDir = join(captureOutDir, "assets")
        await mkdir(assetsDir, { recursive: true })
        for (let i = 0; i < videoUrls.length; i++) {
          const v = videoUrls[i]
          if (!v.url) continue
          try {
            const ext = v.url.includes(".webm") ? "webm" : "mp4"
            const filename = `video-${i}.${ext}`
            const filepath = join(assetsDir, filename)

            // 下载视频（限制 10MB）
            const res = await fetch(v.url)
            if (res.ok) {
              const buffer = Buffer.from(await res.arrayBuffer())
              if (buffer.length <= 10 * 1024 * 1024) {
                writeFileSync(filepath, buffer)
                logger.info("capture:video_saved", { filename, size: buffer.length })
              } else {
                logger.warn("capture:video_too_large", { filename, size: buffer.length })
              }
            }
          } catch (err) {
            logger.warn("capture:video_download_failed", { url: v.url, error: String(err) })
          }
        }
      } catch (err) {
        logger.warn("run_capture:video_extract_failed", { error: String(err) })
      }
    }

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
