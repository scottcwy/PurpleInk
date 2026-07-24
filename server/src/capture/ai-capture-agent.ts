// 从 Firenze frameproof/src/lib/agents/ai-capture-agent.ts 移植。改动仅三处：
//   1. 导入路径改为相对路径；AiAction/CapturedScreenshot/CaptureResult 复用 ../types/capture。
//   2. askAI 走视觉模型（STEP_VISION_MODEL||step-3.7-flash + effort:low + 更大 maxTokens），
//      因为 step-explore 不吃图；推理模型先产 thinking 再产 text，token 需给足。
//   3. 新增 onSnapshot 回调：每保存一张截图时把对应语义快照回传，供适配器拼 visible-text。
import { logger } from "../lib/logger"
import { parseLlmJson } from "../lib/llm-response-parser"
import sharp from "sharp"
import type { BrowserDriver } from "./browser-driver"
import type {
  SemanticSnapshot,
  ScreenshotMetadata,
  AiAction,
  CapturedScreenshot,
  CaptureResult,
} from "../types/capture"
import type { AgentCredentials } from "./credentials"
import { callStepMessages } from "../lib/step-client"

/** 动作延迟配置常量（毫秒）。轻度削减：每步固定间隔/滚动等待取更小值提速，
 * 导航/点击等待保守以免截到未渲染完的页面。 */
const TIMING = {
  NAVIGATE_WAIT: 2000,
  STEP_INTERVAL: 1000,
  CLICK_WAIT: 1500,
  KEY_WAIT: 1500,
  SCROLL_WAIT: 500,
} as const

/** CAPTURE 阶段最多主动关几次全屏遮罩（shadcn 类 sheet/dialog 挡点击的兜底），防死循环。
 * 略宽松一点：有些站（如 shadcn /create 主题编辑器）每次交互都会重开一个弹窗，
 * 5 次给 AI 多几次“关掉→换目标”的机会。 */
const MAX_OVERLAY_ESCAPES = 5

/** ④ 内容密度门限：像素通道平均标准差低于此值视作「近空白」，不入选(不拿来凑镜头) */
const MIN_CONTENT_DENSITY = 8

/**
 * ④ 内容密度评分：用像素通道平均标准差衡量「非空白」程度。
 * 纯色/空白(如未渲染完的 marquee)≈ 0；文字/UI 密集的页面显著更高。
 * 读不了(解码失败)返回 999，不因密度误丢。
 */
async function contentDensity(buffer: Buffer): Promise<number> {
  try {
    const { channels } = await sharp(buffer).stats()
    if (!channels.length) return 0
    return channels.reduce((a, c) => a + c.stdev, 0) / channels.length
  } catch {
    return 999
  }
}

/** ④ 中性截图标签：取页面真实标题，避免「补充截图 N / 页面截图 N」内部占位汄入产物 */
function neutralLabel(snapshot: SemanticSnapshot | null): string {
  const t = (snapshot?.title || "").split(/[|·–—-]/)[0].trim()
  return t ? t.slice(0, 40) : "Product view"
}

/** 共享 actionEnum 定义 */
const ACTION_ENUM = {
  AUTH: '"click" | "fill" | "press_key" | "verify_email" | "scroll" | "navigate"',
  CAPTURE: '"click" | "fill" | "scroll" | "screenshot" | "navigate" | "press_key" | "done"',
} as const

/** 采集阶段：认证 or 采集 */
type CaptureMode = "auth" | "capture"

export interface AiCaptureOptions {
  maxSteps?: number
  minScreenshots?: number
  maxScreenshots?: number
  /** 认证阶段最多花费的步数，超出则放弃认证转采集 */
  authBudget?: number
  /** 登录/注册凭据（智能组合） */
  credentials?: AgentCredentials
  /** 产品一句话介绍，帮助 AI 判断核心功能 */
  description?: string
  /** 视觉模型（覆盖 STEP_VISION_MODEL / step-3.7-flash） */
  visionModel?: string
  /** 每保存一张截图时回调（用于实时进度与持久化）；返回后 buffer 仍会收集到结果中 */
  onScreenshot?: (buffer: Buffer, label: string, index: number, metadata: ScreenshotMetadata) => Promise<void>
  /** 每保存一张截图时回传对应的语义快照（供适配器拼 visible-text.txt，index 与 onScreenshot 对齐） */
  onSnapshot?: (snapshot: SemanticSnapshot, index: number, metadata: ScreenshotMetadata) => Promise<void> | void
  /** 每步决策后回调（用于步骤日志） */
  onStep?: (step: number, action: AiAction) => Promise<void>
}

// 信号关键词表（大小写不敏感，中英双语）
const AUTH_KEYWORDS = [
  "login", "log in", "sign in", "signin", "sign-in",
  "register", "sign up", "signup", "sign-up", "auth",
  "登录", "注册", "登入",
]
// 已登录只认「显式登出控件」这类强信号，避免营销落地页的 dashboard/设置 等词造成误判
const LOGGED_IN_KEYWORDS = [
  "logout", "log out", "sign out", "登出", "退出登录", "注销", "退出账户",
]
// 认证「页面」关键词：只匹配 URL / title（不含正文），用于判定「当前确实在登录/注册页」，
// 从而识别无密码框的登录墙（邮箱先行两步式 / magic link）而不误伤带登录链接的营销首页。
const AUTH_PATH_KEYWORDS = [
  "login", "log-in", "signin", "sign-in", "signup", "sign-up",
  "register", "/auth", "登录", "注册", "登入",
]
// 认证「入口」关键词：匹配 link/button 文案，用于在营销页主动寻找并进入登录/注册。
const AUTH_ENTRY_KEYWORDS = [
  "login", "log in", "sign in", "signin", "sign up", "signup", "sign-up",
  "register", "get started", "登录", "注册", "登入", "免费注册", "开始使用", "免费试用",
]
// 邮箱输入框识别（name/placeholder 命中）
const EMAIL_FIELD_RE = /email|e-mail|邮箱|邮件/
// 验证码「页面」关键词：只匹配 URL / title，用于判定「当前处于邮箱验证码页」。
const VERIFY_PATH_KEYWORDS = [
  "email-verify", "verify-email", "verify", "verification",
  "activate", "activation", "confirm-email", "confirm",
  "验证邮箱", "邮箱验证",
]
// 验证码页正文关键词：用于无明确 URL 时，根据页面文案识别。
const VERIFY_TEXT_KEYWORDS = [
  "输入验证码", "查收邮件", "验证您的邮箱", "验证你的邮箱", "验证并创建",
  "verification code", "enter the code", "enter code", "check your email",
  "we sent", "we've sent", "已发送验证码", "发送到您的邮箱", "6 位验证码", "6位验证码",
]
// 验证码输入框识别（name/placeholder/text 命中）
const CODE_FIELD_RE = /\bcode\b|otp|verif|passcode|验证码|校验码/i

export class AiCaptureAgent {
  private driver: BrowserDriver
  private maxSteps: number
  private minScreenshots: number
  private maxScreenshots: number
  private authBudget: number
  private credentials?: AgentCredentials
  private description?: string
  private visionModel: string
  private onScreenshot?: AiCaptureOptions["onScreenshot"]
  private onSnapshot?: AiCaptureOptions["onSnapshot"]
  private onStep?: AiCaptureOptions["onStep"]

  private visitedUrls = new Set<string>()
  private authSteps = 0
  // 验证码页专用步数：即使 authBudget 耗尽，也允许在验证码页再花几步回填码（临门一脚）。
  private codeSteps = 0
  // LLM 看图判定的登录状态（上一步回传），与关键词启发式合并，作为更可靠的已登录信号。
  private llmLoggedIn = false
  private authCompleted = false
  // CAPTURE 阶段已主动按 Escape 关遮罩的次数（shadcn 类 modal 挡点击兜底，封顶防死循环）。
  private overlayEscapes = 0

  constructor(driver: BrowserDriver, options?: AiCaptureOptions) {
    const apiKey = process.env.STEP_API_KEY
    if (!apiKey) throw new Error("STEP_API_KEY not configured")

    this.driver = driver
    this.maxSteps = options?.maxSteps ?? 14
    this.minScreenshots = options?.minScreenshots ?? 4
    this.maxScreenshots = options?.maxScreenshots ?? 6
    this.authBudget = options?.authBudget ?? 10
    this.credentials = options?.credentials
    this.description = options?.description
    this.visionModel = options?.visionModel || process.env.STEP_VISION_MODEL || "step-3.7-flash"
    this.onScreenshot = options?.onScreenshot
    this.onSnapshot = options?.onSnapshot
    this.onStep = options?.onStep
  }

  async capture(url: string): Promise<CaptureResult> {
    await this.driver.navigate(url)
    await new Promise((r) => setTimeout(r, TIMING.NAVIGATE_WAIT))

    const screenshots: CapturedScreenshot[] = []
    const actions: AiAction[] = []
    // 记录最近几步动作签名，防止死循环
    const recentSignatures: string[] = []
    let lastSnapshot: SemanticSnapshot | null = null

    const saveShot = async (
      buffer: Buffer,
      label: string,
      meta: ScreenshotMetadata,
      snap: SemanticSnapshot | null
    ) => {
      const index = screenshots.length
      screenshots.push({ buffer, label, metadata: meta })
      if (this.onScreenshot) {
        try {
          await this.onScreenshot(buffer, label, index, meta)
        } catch (err) {
          logger.warn("ai_capture:on_screenshot_failed", { error: String(err) })
        }
      }
      // 把对应语义快照回传编排层，供 visible-text 拼接（index 与截图对齐）
      if (this.onSnapshot && snap) {
        try {
          await this.onSnapshot(snap, index, meta)
        } catch (err) {
          logger.warn("ai_capture:on_snapshot_failed", { error: String(err) })
        }
      }
    }

    for (let step = 0; step < this.maxSteps; step++) {
      // 单张截图失败（如“waiting for fonts”超时）不应推翻整轮采集：跳过本步重试。
      let screenshotBuffer: Buffer
      try {
        screenshotBuffer = await this.driver.screenshot()
      } catch (err) {
        logger.warn("ai_capture:screenshot_failed", { step, error: String(err) })
        await new Promise((r) => setTimeout(r, TIMING.STEP_INTERVAL))
        continue
      }
      let snapshot: SemanticSnapshot
      try {
        snapshot = await this.driver.snapshot()
        lastSnapshot = snapshot
        if (snapshot.url) this.visitedUrls.add(stripUrl(snapshot.url))
      } catch {
        snapshot = { title: "", elements: [], textContent: "" }
      }

      // ---- 外层状态机：根据客观信号派生当前 mode ----
      const wallKind = this.authWallKind(snapshot)
      const authWall = wallKind !== "none"
      // 已登录信号：关键词启发式 OR LLM 上一步看图的判断（图文能力比关键词更可靠）。
      const loggedIn = this.looksLoggedIn(snapshot) || this.llmLoggedIn
      const hasAuthEntry = this.hasAuthEntry(snapshot)
      // authWall（存在密码框或处于登录页的登录墙）是比 loggedIn 关键词更强的"当前时刻"信号：
      // 只要正面对登录墙，就说明此刻并未登录 —— 据此撤销可能的误判
      // （如 landing→demo dashboard 触发的假 loggedIn），实现计划中
      // "CAPTURE 撞登录墙且未真正认证 → 回退 AUTH"。
      if (authWall) {
        if (this.authCompleted) {
          logger.info("ai_capture:auth_wall_revoke", { step, url: snapshot.url })
        }
        this.authCompleted = false
      } else if (loggedIn && !this.authCompleted) {
        this.authCompleted = true
        logger.info("ai_capture:auth_success_detected", { step, url: snapshot.url })
      }
      // 提供了凭据且未认证、预算未耗尽时，想进入认证阶段：
      // 不仅当前就是登录墙（authWall）时进，当页面存在登录/注册入口（hasAuthEntry）
      // 时也主动进——由 AUTH prompt 引导点击入口，避免在营销首页干绕而进不了功能页。
      // 验证码页（wallKind==="code"）是“临门一脚”的关键环节：即使 authBudget 耗尽也要给
      // 它额外的 codeSteps 预算去回填验证码，否则白白在最后一步放弃。
      const isCodePage = wallKind === "code"
      const CODE_BUDGET = 4
      const wantAuth =
        !this.authCompleted &&
        !!this.credentials &&
        (this.authSteps < this.authBudget || (isCodePage && this.codeSteps < CODE_BUDGET))
      const mode: CaptureMode =
        wantAuth && (authWall || hasAuthEntry) ? "auth" : "capture"

      logger.info("ai_capture:step", {
        step, mode, screenshotsTaken: screenshots.length,
        authWall, wallKind, hasAuthEntry, loggedIn, authSteps: this.authSteps,
      })

      // ---- shadcn 类 sheet/dialog 遮罩兜底（与登录墙无关）----
      // 部分站点（如 ui.shadcn.com）会弹出全屏模态（command 面板 / sheet / cookie 遮罩），
      // 它以 pointer-events 挡住背后所有点击 → AI 点不动、截图数被封在四张。
      // 这类遮罩不是登录墙（authWall 已单独处理），按 Escape 即可关。
      // 只在 CAPTURE 阶段、非登录墙、且未超封顶时主动探测并关遮罩，关后重新取快照。
      if (mode === "capture" && !authWall && this.overlayEscapes < MAX_OVERLAY_ESCAPES) {
        let blocked = false
        try { blocked = await this.detectBlockingOverlay() } catch { /* ignore */ }
        if (blocked) {
          this.overlayEscapes++
          logger.info("ai_capture:overlay_escape", { step, attempt: this.overlayEscapes, url: snapshot.url })
          try { await this.driver.pressKey("Escape") } catch { /* ignore */ }
          await new Promise((r) => setTimeout(r, TIMING.KEY_WAIT))
          continue
        }
      }

      // 登录框 / 注册框一律不截图：无论 LLM 决策还是兆底逻辑想保存当前帧，
      // 只要此刻正对着登录墙（有密码框 + 认证关键词）就拦掉，宁可少一张也不
      // 让登录/注册页混进演示视频。返回是否真的保存了。
      const shootCurrent = async (label: string, decision?: AiAction): Promise<boolean> => {
        if (authWall) {
          logger.info("ai_capture:skip_auth_screenshot", { step, url: snapshot.url })
          return false
        }
        // ④ 截图前静置：等字体/入场动画/懒加载(marquee 等)渲染完，避免截到空白
        if (this.driver.settle) {
          try { await this.driver.settle() } catch { /* ignore */ }
        }
        // ④ 优先元素级紧裁：AI 指定了目标容器 ref 时单独截该元素(整帧留白由 compose 层兑底)
        let buf: Buffer | null = null
        if (decision && typeof decision.ref === "number" && this.driver.screenshotElement) {
          const sel = this.resolveSelector(decision, snapshot)
          if (sel) {
            try { buf = await this.driver.screenshotElement(sel) } catch { buf = null }
          }
        }
        // 元素级不可用则静置后重抓一帧整帧(比循环顶部的旧帧更新)
        if (!buf) {
          try { buf = await this.driver.screenshot() } catch { buf = null }
        }
        if (!buf) buf = screenshotBuffer
        // ④ 内容密度门：近空白帧不入选，不拿来凑镜头
        const density = await contentDensity(buf)
        if (density < MIN_CONTENT_DENSITY) {
          logger.info("ai_capture:skip_blank_screenshot", { step, density: Math.round(density), url: snapshot.url })
          return false
        }
        const metadata: ScreenshotMetadata = {
          pageUrl: snapshot.url,
          captureMode: mode,
          authWallSeen: authWall,
          aiDecision: decision ? `${decision.action} ${decision.label || ""}`.trim() : undefined,
          pageType: this.inferPageType(snapshot, authWall, loggedIn),
        }
        await saveShot(buf, label, metadata, snapshot)
        return true
      }

      let decision: AiAction
      try {
        decision = await this.askAI(screenshotBuffer, snapshot, {
          mode,
          screenshotsTaken: screenshots.length,
          previousActions: actions,
        })
      } catch (err) {
        logger.warn("ai_capture:ai_decision_failed", { step, error: String(err) })
        if (mode === "capture" && screenshots.length < this.minScreenshots) {
          decision = { action: "scroll", value: "down", label: "向下滚动", reason: "AI 调用失败，降级滚动" }
        } else if (mode === "auth") {
          decision = { action: "scroll", value: "down", label: "向下滚动", reason: "AI 调用失败，降级滚动" }
          this.authSteps++
        } else {
          await shootCurrent(neutralLabel(snapshot))
          break
        }
      }

      logger.info("ai_capture:decision", {
        step, mode, action: decision.action, ref: decision.ref,
        label: decision.label, reason: decision.reason,
      })
      if (this.onStep) {
        try { await this.onStep(step, decision) } catch { /* ignore */ }
      }

      // 采纳 LLM 看图给出的登录判断：缓存供下一步状态机使用；若本步已登录且不在登录墙，
      // 立即将 authCompleted 置真，避免已登录却又重入认证。（authWall 仍会在下一轮撞墙时撤销。）
      if (typeof decision.loggedIn === "boolean") {
        this.llmLoggedIn = decision.loggedIn
        if (decision.loggedIn && !authWall && !this.authCompleted) {
          this.authCompleted = true
          logger.info("ai_capture:auth_success_by_llm", { step, url: snapshot.url })
        }
      }

      // ---- 完成条件（仅 CAPTURE 阶段生效）----
      if (mode === "capture" && (decision.action === "done" || screenshots.length >= this.maxScreenshots)) {
        await shootCurrent(decision.label || neutralLabel(snapshot), decision)
        break
      }

      // ---- 显式截图（AUTH 阶段不采集登录页，仅计步）----
      if (decision.action === "screenshot") {
        if (mode === "capture") {
          const saved = await shootCurrent(decision.label || neutralLabel(snapshot), decision)
          if (saved) {
            actions.push(decision)
            if (screenshots.length >= this.maxScreenshots || step >= this.maxSteps - 2) break
          }
          // 未保存（撞登录墙）：不计入截图，继续让 AI 尝试进入真正的功能页
        } else {
          this.authSteps++
        }
        continue
      }

      // 导航前先留存当前功能页（仅 CAPTURE，且非登录墙）
      if (decision.action === "navigate" && mode === "capture" && screenshots.length < this.maxScreenshots) {
        await shootCurrent(decision.label || neutralLabel(snapshot), decision)
      }

      // 死循环保护：连续重复同一动作则强制换策略
      const sig = `${decision.action}:${decision.ref ?? decision.selector ?? ""}:${decision.value ?? ""}`
      recentSignatures.push(sig)
      if (recentSignatures.length > 3) recentSignatures.shift()
      if (recentSignatures.length === 3 && recentSignatures.every((s) => s === sig)) {
        logger.warn("ai_capture:loop_detected", { step, mode, sig })
        // 卡死兜底：先按 Escape 关掉可能的模态遮罩（shadcn sheet/dialog 挡点击），
        // 再滚动换一屏内容，促使 AI 换目标（而不是在同一个被挡元素上反复点击）。
        try { await this.driver.pressKey("Escape") } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, TIMING.KEY_WAIT))
        try { await this.driver.scroll("down") } catch { /* ignore */ }
        recentSignatures.length = 0
        if (mode === "auth") { this.authSteps++; if (isCodePage) this.codeSteps++ }
        continue
      }

      try {
        await this.executeAction(decision, lastSnapshot)
        actions.push(decision)
      } catch (err) {
        const msg = String(err)
        logger.warn("ai_capture:action_failed", { step, action: decision.action, error: msg })
        // 遮罩兜底（模态无关）：点击因「intercepts pointer events」超时失败，
        // 说明有个全屏遮罩（如 shadcn/base-ui 的 dialog-overlay 命令面板）挡在前面。
        // 这是比主动探测更硬的信号（真正挡住才会报），按 Escape 关遮罩，
        // 下一步 AI 就能换目标。仅在未超封顶时做，避免死循环。
        if (/intercepts pointer events/i.test(msg) && this.overlayEscapes < MAX_OVERLAY_ESCAPES) {
          this.overlayEscapes++
          logger.info("ai_capture:overlay_escape_on_block", { step, attempt: this.overlayEscapes })
          try { await this.driver.pressKey("Escape") } catch { /* ignore */ }
          await new Promise((r) => setTimeout(r, TIMING.KEY_WAIT))
        }
      }

      if (mode === "auth") { this.authSteps++; if (isCodePage) this.codeSteps++ }

      await new Promise((r) => setTimeout(r, TIMING.STEP_INTERVAL))
    }

    // 兜底：截图不足时（常见于登录/注册失败或整站需登录），回到入口页采集公开可见内容。
    // 宁可用干净的营销首页/公开页兜底，也不输出空产物；但仍不保存任何登录/注册页。
    if (screenshots.length < this.minScreenshots) {
      logger.info("ai_capture:fallback_public_sweep", {
        have: screenshots.length, need: this.minScreenshots, authCompleted: this.authCompleted,
      })
      try {
        await this.driver.navigate(url)
        await new Promise((r) => setTimeout(r, TIMING.NAVIGATE_WAIT))
      } catch { /* ignore */ }

      const sweepMax = Math.max(5, this.minScreenshots)
      for (let i = 0; i < sweepMax && screenshots.length < this.minScreenshots; i++) {
        let sweepSnap: SemanticSnapshot | null = lastSnapshot
        try { sweepSnap = await this.driver.snapshot() } catch { /* keep last */ }
        // ④ 静置后再截，避免抓到未渲染完的空帧
        if (this.driver.settle) { try { await this.driver.settle() } catch { /* ignore */ } }
        let sweepBuf: Buffer | null = null
        try { sweepBuf = await this.driver.screenshot() } catch { /* ignore */ }
        if (!sweepBuf) break

        if (sweepSnap && this.isAuthWall(sweepSnap)) {
          logger.info("ai_capture:skip_auth_screenshot_final", { url: sweepSnap.url })
        } else if ((await contentDensity(sweepBuf)) < MIN_CONTENT_DENSITY) {
          // ④ 近空白帧不拿来凑镜头
          logger.info("ai_capture:skip_blank_screenshot_final", { url: sweepSnap?.url })
        } else {
          const meta: ScreenshotMetadata = {
            pageUrl: sweepSnap?.url,
            captureMode: "capture",
            authWallSeen: false,
            pageType: sweepSnap ? this.inferPageType(sweepSnap, false, false) : "marketing",
          }
          await saveShot(sweepBuf, neutralLabel(sweepSnap), meta, sweepSnap)
        }
        try { await this.driver.scroll("down") } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, TIMING.SCROLL_WAIT))
      }
    }

    logger.info("ai_capture:completed", {
      totalScreenshots: screenshots.length, totalActions: actions.length,
      authCompleted: this.authCompleted,
    })
    return { screenshots, actions }
  }

  /**
   * 判定当前登录墙类型：
   * - "password"    ：存在密码输入框 且 页面含认证关键词（账密登录/注册）。
   * - "passwordless"：当前 URL/标题命中认证路径（确实在登录/注册页）且有邮箱/文本输入框但无密码框
   *                  （邮箱先行两步式 / magic link）。
   * - "none"        ：非登录墙。
   */
  private authWallKind(snapshot: SemanticSnapshot): "password" | "passwordless" | "code" | "none" {
    const hasPassword = snapshot.elements.some((e) => e.type === "password")
    const hay = `${snapshot.url || ""} ${snapshot.title || ""} ${snapshot.textContent || ""}`.toLowerCase()

    // 邮箱验证码页：无密码框，但处于 verify 路径 / 正文提示验证码，且页面有可填写的输入框。
    // 优先于 password/passwordless 判定，因为它是“注册/登录提交后”的专属环节。
    if (!hasPassword && this.isVerifyCodePage(snapshot)) return "code"

    if (hasPassword && AUTH_KEYWORDS.some((k) => hay.includes(k))) return "password"

    // 无密码墙：仅依据 URL/标题（不含正文）判定是否确实在认证页，避免带登录链接的营销首页误判
    const locus = `${snapshot.url || ""} ${snapshot.title || ""}`.toLowerCase()
    if (AUTH_PATH_KEYWORDS.some((k) => locus.includes(k))) {
      const hasEmailInput = snapshot.elements.some(
        (e) =>
          e.type === "email" ||
          (e.tag === "input" && EMAIL_FIELD_RE.test(`${e.name || ""} ${e.placeholder || ""}`.toLowerCase()))
      )
      const hasTextInput = snapshot.elements.some(
        (e) => e.tag === "input" && (!e.type || e.type === "text" || e.type === "email")
      )
      if (hasEmailInput || hasTextInput) return "passwordless"
    }
    return "none"
  }

  /**
   * 判定当前是否为邮箱验证码输入页（注册/登录提交后的“输入邮箱验证码”环节）。
   * 信号：(URL/标题命中 verify 路径 或 正文命中验证码提示) 且页面存在可填写的输入框。
   */
  private isVerifyCodePage(snapshot: SemanticSnapshot): boolean {
    const locus = `${snapshot.url || ""} ${snapshot.title || ""}`.toLowerCase()
    const text = (snapshot.textContent || "").toLowerCase()
    const urlHit = VERIFY_PATH_KEYWORDS.some((k) => locus.includes(k))
    const textHit = VERIFY_TEXT_KEYWORDS.some((k) => text.includes(k.toLowerCase()))
    if (!urlHit && !textHit) return false

    // 页面需有可填写的输入框（验证码框常为 text/tel/number，或 name/placeholder 命中 code/otp/验证码）。
    const hasInput = snapshot.elements.some((e) => {
      if (e.tag !== "input" && e.role !== "textbox") return false
      if (e.type === "password") return false
      const hint = `${e.name || ""} ${e.placeholder || ""} ${e.text || ""}`
      const t = e.type || ""
      return CODE_FIELD_RE.test(hint) || t === "text" || t === "tel" || t === "number" || t === "" || t === "email"
    })
    return hasInput
  }

  /** 判断当前是否为登录/注册墙（含密码墙与无密码墙） */
  private isAuthWall(snapshot: SemanticSnapshot): boolean {
    return this.authWallKind(snapshot) !== "none"
  }

  /** 判断页面是否存在登录/注册入口（链接或按钮文案命中认证入口关键词） */
  private hasAuthEntry(snapshot: SemanticSnapshot): boolean {
    return snapshot.elements.some((e) => {
      const isClickable = e.role === "button" || e.role === "link" || e.tag === "a" || e.tag === "button"
      if (!isClickable) return false
      const label = `${e.text || ""} ${e.name || ""}`.toLowerCase()
      if (!label.trim()) return false
      return AUTH_ENTRY_KEYWORDS.some((k) => label.includes(k))
    })
  }

  /** 判断是否已登录：无密码框 且 出现登出/控制台等已登录标志 */
  private looksLoggedIn(snapshot: SemanticSnapshot): boolean {
    const hasPassword = snapshot.elements.some((e) => e.type === "password")
    if (hasPassword) return false
    const hay = `${snapshot.url || ""} ${snapshot.title || ""} ${snapshot.textContent || ""}`.toLowerCase()
    return LOGGED_IN_KEYWORDS.some((k) => hay.includes(k))
  }

  /** 根据当前页面信号推断 pageType */
  private inferPageType(snapshot: SemanticSnapshot, authWall: boolean, loggedIn: boolean): ScreenshotMetadata["pageType"] {
    if (authWall) return "auth"
    const hay = `${snapshot.url || ""} ${snapshot.title || ""} ${snapshot.textContent || ""}`.toLowerCase()
    // 营销页特征
    const marketingKw = ["pricing", "features", "about", "blog", "landing", "hero", "定价", "产品介绍"]
    if (marketingKw.some((k) => hay.includes(k))) return "marketing"
    // Onboarding 特征
    const onboardingKw = ["onboarding", "welcome", "get started", "setup", "开始使用", "欢迎"]
    if (onboardingKw.some((k) => hay.includes(k))) return "onboarding"
    // 已登录的功能页
    if (loggedIn) return "product"
    return "product"
  }

  private async askAI(
    screenshot: Buffer,
    snapshot: SemanticSnapshot,
    context: { mode: CaptureMode; screenshotsTaken: number; previousActions: AiAction[] }
  ): Promise<AiAction> {
    const base64 = screenshot.toString("base64")
    const prompt = this.buildStepPrompt(snapshot, context)

    // 走视觉模型：step-explore 不吃图，需 step-3.7-flash（推理模型，先 thinking 再 text）。
    // effort:low 收敛思考，maxTokens 给足以免 thinking 吃光正文导致 JSON 缺失。
    const content = await callStepMessages({
      model: this.visionModel,
      effort: "low",
      system:
        "你是一个网页浏览 Agent，负责主动登录/注册并采集产品核心功能截图。只返回 JSON，不要其他文字。",
      maxTokens: 1500,
      content: [
        { type: "text", text: prompt },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: base64 },
        },
      ],
    })

    const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
    return parseLlmJson<AiAction>(jsonStr, { action: "scroll", value: "down", label: "降级滚动" })
  }

  /** 构建每步决策的完整 prompt */
  private buildStepPrompt(
    snapshot: SemanticSnapshot,
    context: { mode: CaptureMode; screenshotsTaken: number; previousActions: AiAction[] }
  ): string {
    // 精简元素：交互控件优先，保留 ref 供回传
    const keyElements = snapshot.elements
      .filter((el) =>
        el.role === "button" || el.role === "link" || el.role === "textbox" ||
        el.tag === "input" || el.tag === "textarea" || el.tag === "select" ||
        el.tag === "h1" || el.tag === "h2" || el.tag === "h3" ||
        (el.text && el.text.length > 0)
      )
      .slice(0, 40)

    const elementsStr = keyElements.map((el) => {
      const typePart = el.type ? ` type="${el.type}"` : ""
      const namePart = el.name ? ` name="${el.name}"` : ""
      const phPart = el.placeholder ? ` placeholder="${el.placeholder}"` : ""
      return `[${el.ref}] <${el.tag}> role="${el.role}"${typePart}${namePart}${phPart} text="${(el.text || "").substring(0, 50)}"`
    }).join("\n") || "无可交互元素"

    const prevActionsStr = context.previousActions.length > 0
      ? context.previousActions.slice(-6).map((a) => `${a.action}(${a.label || ""})`).join(" → ")
      : "刚开始"

    const visitedStr = Array.from(this.visitedUrls).slice(-8).join(", ") || "无"
    const { phaseGoal, guidance, rules, actionEnum } = context.mode === "auth"
      ? this.buildAuthPrompt(this.authWallKind(snapshot))
      : this.buildCapturePrompt()

    return `你是一个网页浏览 Agent，最终目标是**进入产品的核心功能页面并采集截图**，用于制作产品演示视频。
${this.description ? `产品简介：${this.description}\n` : ""}
== 当前阶段：${phaseGoal} ==

当前页面截图已附上（请看图片）。页面标题：${snapshot.title || "未知"}
当前 URL：${snapshot.url || "未知"}
已访问过的页面：${visitedStr}

页面可交互元素（用 [ref] 编号回传定位）：
${elementsStr}

当前状态：
- 已采集 ${context.screenshotsTaken} 张截图（最少 ${this.minScreenshots} 张，最多 ${this.maxScreenshots} 张）
- 之前的操作：${prevActionsStr}

${guidance}决策规则：
${rules}

只返回 JSON（不要其它文字）：
{
  "action": ${actionEnum},
  "ref": 元素编号（click/fill 时从上面列表选取，数字）,
  "value": "值（fill 内容或占位符 / scroll 的 down|up / navigate 的 URL / press_key 的按键）",
  "label": "操作描述（中文，10字以内）",
  "reason": "原因（中文，20字以内）",
  "loggedIn": 布尔值（看当前截图判断：若页面显示已登录——出现账号头像/用户名/邮箱、后台侧边导航、退出登录、仪表盘等——填 true；仍是登录/注册/营销页则 false）
}`
  }

  /** AUTH 阶段的目标、指引、规则、可用 action */
  private buildAuthPrompt(wallKind: "password" | "passwordless" | "code" | "none"): { phaseGoal: string; guidance: string; rules: string; actionEnum: string } {
    const c = this.credentials

    // 验证码页：已提交注册/登录，当前需回填邮箱验证码完成认证——给专用的专注指令，避免跑题。
    if (wallKind === "code") {
      const guidance = `邮箱验证码阶段（临门一脚）：
本页是【邮箱验证码输入页】，站点已向注册邮箱发送了验证码。你的唯一任务是把验证码填进去并提交：
- fill 验证码输入框（页面中用于输入验证码/code/OTP 的框），value 统一用 "{{code}}"——系统会自动从邮箱读取最新验证码填入。
- 填完后 click【验证 / 确认 / 提交 / 创建账户 / 下一步】按钮，或 press_key "Enter"。
- 若验证码为多个单字符框，也只需对第一个框 fill "{{code}}"（系统会整串填入）。
`
      const rules = `1. 绝不要离开本页（不要 navigate、不要去首页/功能页），未完成验证前任务未结束。
2. 首选 action "fill"，value "{{code}}"，对准验证码输入框。
3. 验证码已填入后，click 提交/验证按钮 或 press_key "Enter"。
4. 本阶段不要截图；验证成功进入功能页后系统会自动切换到采集阶段。
5. 若页面提示验证码错误/过期，可再次 fill "{{code}}"（系统会重新取最新码）并重新提交。`
      return { phaseGoal: "输入邮箱验证码（完成认证）", guidance, rules, actionEnum: ACTION_ENUM.AUTH }
    }

    const modeLine = c?.mode === "user"
      ? "已提供测试账号，请优先寻找「登录 / Sign in / Log in」入口并登录。"
      : "未提供账号，请寻找「注册 / Sign up / Get started」入口自助注册；若只有登录页也可尝试注册链接。"
    const codeLine = c?.mode === "auto" && c?.canReadEmail
      ? '- 邮箱验证码：填写验证码输入框时 value 用 "{{code}}"，系统会自动从邮箱读取最新验证码填入。\n'
      : ""
    // 无密码/邮箱先行墙：引导先填邮箱提交，再根据后续页面（密码框 / magic link）处理
    const passwordlessLine = wallKind === "passwordless"
      ? '- 本页疑似「无密码 / 邮箱先行」登录：先 fill 邮箱字段 value "{{email}}" 并提交（点继续/下一步或 press_key "Enter"）；若随后出现密码框再 fill "{{password}}"；若提示「已发送登录链接 / magic link / 请查收邮件」则返回 action "verify_email"。\n'
      : ""

    const guidance = `登录/注册指引（${c?.mode === "user" ? "登录优先" : "自助注册"}）：
${modeLine}
填写账号表单时请使用以下占位符作为 value（系统会自动替换为真实值，请勿编造）：
- 邮箱字段：value 用 "{{email}}"
- 密码字段（含"确认密码"）：value 用 "{{password}}"
- 姓名/用户名字段：value 用 "{{name}}"
${passwordlessLine}${codeLine}逐个字段 fill，填完后点击提交按钮或 press_key "Enter"。
`

    const rules = `1. 本阶段唯一任务是**完成登录/注册**，进入功能页后系统会自动切换到采集阶段，你**不要**在本阶段截图。
2. 逐个字段 fill 账号信息（用占位符），再 click 提交按钮或 press_key "Enter"。
3. **若页面提示"邮箱已注册 / already registered / already exists / 已存在"，说明注册已成功，请立刻切换到「登录」tab，用同一账号登录，切勿重复注册。**
4. 若出现验证码输入框，fill "{{code}}"（系统自动读取邮箱验证码）。
5. **若页面提示"已发送验证邮件 / 请查收邮件 / 点击邮件中的链接激活"且没有验证码输入框，返回 action "verify_email"（系统会自动去邮箱取激活链接并打开）。**
6. 不要重复完全相同的操作；一个字段填过就不要再填。`

    const actionEnum = ACTION_ENUM.AUTH
    return { phaseGoal: "登录 / 注册（认证）", guidance, rules, actionEnum }
  }

  /** CAPTURE 阶段的目标、指引、规则、可用 action */
  private buildCapturePrompt(): { phaseGoal: string; guidance: string; rules: string; actionEnum: string } {
    const guidance = `采集指引（先分析功能 → 让功能呈现 → 再截图）：
1. 你已进入产品（或本就无需登录）。先观察当前页面与导航，判断产品提供了哪些**核心功能**（如编辑器/对话/生成/数据面板/上传等）。
2. 进入某个功能后，**先与它交互让功能真正「呈现出结果」再截图** —— 例如在输入框 fill 一段示例内容并点击生成/运行按钮、展开面板，使界面展示真实内容而非空白状态。
3. 尽量覆盖 ${this.minScreenshots}~${this.maxScreenshots} 个**不同功能**，每个功能呈现后截 1 张。
`
    const rules = `1. **绝对不要对登录页 / 注册页 / 密码输入页截图**；若当前处于这类页面，改为 click 进入功能或 navigate 离开，不要选 screenshot。
2. 只有页面确实展示了产品**核心功能的真实使用效果**时才选 "screenshot"；空白表单、纯营销首页都不算。
3. 要让功能「呈现」出来：可先 fill 示例内容 / click 生成或运行按钮 / 展开区域，等界面真正渲染出内容再截图。
4. **screenshot 时尽量给出正在展示核心功能的主内容容器 [ref]**（如编辑器/画布/数据面板/结果区），系统会对该元素做紧裁；别停在文档侧栏/页脚/导航 logo/cookie 条。
5. 需进入功能时用 "click"（给出目标 [ref]）或 "navigate"；内容不全时 "scroll" value="down"。
6. 已采集足够多**不同功能页面**（≥${this.minScreenshots}）时选 "done"。
7. 不要重复访问已看过的页面，不要重复相同操作。`

    const actionEnum = ACTION_ENUM.CAPTURE
    return { phaseGoal: "采集核心功能截图", guidance, rules, actionEnum }
  }

  private async executeAction(action: AiAction, snapshot: SemanticSnapshot | null): Promise<void> {
    const targetSelector = this.resolveSelector(action, snapshot)

    switch (action.action) {
      case "click":
        if (targetSelector) {
          await this.driver.click(targetSelector)
          await new Promise((r) => setTimeout(r, TIMING.CLICK_WAIT))
        }
        break

      case "fill":
        if (targetSelector && action.value) {
          const value = await this.resolveValue(action.value)
          if (value === null) {
            // {{code}} 只拿到激活链接，则直接导航
            break
          }
          await this.driver.fill(targetSelector, value)
        }
        break

      case "scroll":
        await this.driver.scroll((action.value || "down") as "down" | "up" | "left" | "right")
        await new Promise((r) => setTimeout(r, TIMING.SCROLL_WAIT))
        break

      case "press_key":
        await this.driver.pressKey(action.value || "Enter")
        await new Promise((r) => setTimeout(r, TIMING.KEY_WAIT))
        break

      case "verify_email": {
        // 无验证码输入框场景：主动去邮箱取激活链接并打开
        if (this.credentials) {
          const result = await this.credentials.fetchEmailCode()
          if (result?.link) {
            logger.info("ai_capture:verify_email_navigate", { link: result.link })
            await this.driver.navigate(result.link)
            await new Promise((r) => setTimeout(r, TIMING.NAVIGATE_WAIT))
          } else {
            logger.warn("ai_capture:verify_email_no_link", { hasCode: !!result?.code })
          }
        }
        break
      }

      case "navigate":
        if (action.value) {
          await this.driver.navigate(action.value)
          await new Promise((r) => setTimeout(r, TIMING.NAVIGATE_WAIT))
        }
        break

      case "screenshot":
      case "done":
        break
    }
  }

  /**
   * 在页面上下文探测是否存在「全屏固定定位 + 高 z-index」的模态遮罩（shadcn/Radix
   * 类 sheet/dialog、命令面板、cookie 遮罩），它会以 pointer-events 挡住背后点击。
   * 判据：Radix 显式标记（[role=dialog][data-state=open] 等）或任意 position:fixed
   * 且覆盖 ≥60% 视口、z-index≥20 的可见层。以字符串 IIFE 传入 evaluate（避开
   * esbuild keepNames 对具名函数的包裹），异常一律视为无遮罩。
   */
  private async detectBlockingOverlay(): Promise<boolean> {
    const script = `(() => {
  try {
    var vw = window.innerWidth, vh = window.innerHeight;
    var blocking = function (el) {
      var s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
      if (s.pointerEvents === 'none') return false;
      var r = el.getBoundingClientRect();
      var coversMost = r.width >= vw * 0.6 && r.height >= vh * 0.6;
      var z = parseInt(s.zIndex, 10) || 0;
      return coversMost && s.position === 'fixed' && z >= 20;
    };
    var markers = document.querySelectorAll('[role=\\'dialog\\'][data-state=\\'open\\'],[role=\\'alertdialog\\'][data-state=\\'open\\'],[data-radix-popper-content-wrapper],[data-state=\\'open\\'][class*=\\'overlay\\']');
    for (var i = 0; i < markers.length; i++) { if (blocking(markers[i])) return true; }
    var all = document.querySelectorAll('div,section,aside');
    for (var j = 0; j < all.length; j++) { if (blocking(all[j])) return true; }
    return false;
  } catch (e) { return false; }
})()`
    return await this.driver.evaluate<boolean>(script)
  }

  /** 将 ref 或 selector 解析为可用于 driver 的选择器 */
  private resolveSelector(action: AiAction, snapshot: SemanticSnapshot | null): string | undefined {
    if (typeof action.ref === "number") {
      // 校验 ref 是否存在于快照，避免 AI 编造
      const exists = snapshot?.elements.some((el) => el.ref === action.ref)
      if (exists || !snapshot) return `[data-fp-ref="${action.ref}"]`
    }
    return action.selector
  }

  /**
   * 解析 fill 值中的占位符。
   * 返回 null 表示无需填充（例如 {{code}} 只拿到激活链接，需改为导航）。
   */
  private async resolveValue(raw: string): Promise<string | null> {
    const c = this.credentials
    if (!c) return raw

    if (raw.includes("{{code}}")) {
      const result = await c.fetchEmailCode()
      if (result?.code) return raw.replace("{{code}}", result.code)
      if (result?.link) {
        // 收到激活链接：直接导航激活
        try {
          await this.driver.navigate(result.link)
          await new Promise((r) => setTimeout(r, TIMING.NAVIGATE_WAIT))
        } catch { /* ignore */ }
        return null
      }
      return raw.replace("{{code}}", "")
    }

    return raw
      .replace("{{email}}", c.email)
      .replace("{{password}}", c.password)
      .replace("{{name}}", c.name)
  }
}

/** 去掉 URL 的查询串与哈希，便于去重 */
function stripUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return url
  }
}
