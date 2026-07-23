# Firenze 采集 Agent 设计说明（Purple Ink 组件①）

> 把「网站 → 自动注册/登录 → 采集核心功能截图」这条链路涉及的代码集中提取、分类讲解。
> 所有代码块均从源文件逐字拷贝，可直接对照阅读 / 复用。
>
> **给队友的一句话**：这个 Agent 是 Purple Ink 的**第一环（采集）**。它能进登录墙、抓到真实产品界面，产出一批「截图 + 元数据 + 语义快照」。我们**不改它的核心逻辑**，只在它后面接一个**适配器**把产物翻译成 HyperFrames 官方 `capture/` 格式，从而复用官方的整条视频生成管线。先读下面两节（定位 + 输出契约）理解全局，再看 §0–§6 的代码细节。

## 目录
- [定位：这个 Agent 在 Purple Ink 里扮演什么](#定位这个-agent-在-purple-ink-里扮演什么)
- [输出契约：Agent 产物 → Capture 适配器](#输出契约agent-产物--capture-适配器)
- [0. 架构总览与数据流](#0-架构总览与数据流)
- [1. 涉及文件清单](#1-涉及文件清单)
- [2. 注册 / 登录](#2-注册--登录)
- [3. 截图](#3-截图)
- [4. 识别（页面类型 / 登录墙 / 已登录）](#4-识别页面类型--登录墙--已登录)
- [5. 主循环状态机](#5-主循环状态机)
- [6. LLM 多模态调用](#6-llm-多模态调用)

---

## 定位：这个 Agent 在 Purple Ink 里扮演什么

Purple Ink 的洞察是：**不重写 HyperFrames，而是替换它官方 `Website to Video` 管线的第一步 Capture**。官方 Capture 只能抓公开落地页；我们用这个 Firenze Agent 顶上去——它能自动注册/登录、进登录墙抓到**真实产品界面**，这是核心差异化。

```
            Purple Ink 三块
┌─────────────────────────────────────────────────────────────┐
│ ① Firenze Capture Agent   ← 本文档讲的就是这块（已完成）        │
│    URL → 登录/探索/截图 → 产出 { screenshots, actions }         │
│                     │                                          │
│                     ▼                                          │
│ ② Capture 适配器          ★唯一核心新代码（M2 要写）             │
│    把 ① 的产物翻译成官方 capture/ 目录格式                        │
│      · tokens.json（品牌色/字体/CSS变量）                        │
│      · visible-text.txt（逐页可见文字）                          │
│      · asset-descriptions.md（每张截图的视觉描述）                │
│      · assets/NN-*.png（截图落盘）                              │
│                     │                                          │
│                     ▼                                          │
│ ③ HyperFrames 官方 Step2→6（黑盒复用，不改）                     │
│    Design → Storyboard → TTS → Compose → Render → video.mp4     │
└─────────────────────────────────────────────────────────────┘
```

**为什么这么分工**：官方管线的 Step2→6（设计/分镜/配音/合成/渲染）质量已经很高，我们只要让 ① 的产物**长得像官方 Capture 的产物**，就能整条复用。换句话说——**②适配器是我们唯一真正要精工的自研代码，① 直接复用、③ 当黑盒调**。理解这一点，就理解了整个项目。

---

## 实现进度（`server/` 后端，截至 M4）

> 本文档原是对 Firenze 源码的讲解；下面这节记录**在 Purple Ink `server/` 里的落地状态**，与上文的源码剖析对照阅读。

### 已完成

**M2 — Capture 适配器（②，核心自研）** ✅ `server/src/adapter/`
- `build-tokens.ts` / `build-visible-text.ts` / `describe-assets.ts` / `write-capture.ts` / `index.ts`：把 `CaptureResult + snapshots + pageTokens` 翻译成官方 `capture/{meta.json, assets/NN-*.png, extracted/{tokens.json, visible-text.txt, asset-descriptions.md}}`。
- `extract-page-tokens.ts`：**填平了下方「已知缺口」** —— 品牌色/字体/CSS 变量的采集不再改 `snapshot()`，而是把自包含函数 `extractPageTokensInBrowser` 通过 `driver.evaluate()` 注入浏览器执行，产出 `tokens.json`。
- 对拍验证 `scripts/verify-golden.ts`：用官方金样本 `_capture_probe` 造 `AdapterInput`，跑适配器，断言 Gate 结构/格式对齐 —— **25/25 全通过（含真实 StepFun 视觉调用）**。

**M3 — 接 Firenze 实时采集（①→②接线）** ✅ `server/src/capture/`
- 从 Firenze 移植：`browser-driver.ts`（接口 + 工厂）、`playwright-driver.ts`（真浏览器）、`mock-driver.ts`（去 sharp，内嵌 1×1 PNG，供无浏览器冒烟）、`imap-email.ts`、`credentials.ts`、`ai-capture-agent.ts`。
- 新增编排器 `run-capture.ts`：`createDriver → launch → driver.evaluate(extractPageTokensInBrowser) 抓品牌 → resolveCredentials → AiCaptureAgent.capture → runCaptureAdapter`。
- 新增 CLI `scripts/capture-url.ts`：`npm run capture -- <url> [--mock] [--no-vision] [--email/--password] [--min/--max/--steps] ...`。
- **mock 干跑冒烟通过**：`agent（真 StepFun 视觉决策）→ mock driver → 适配器` 全链产出合法 `capture/` 目录。

**M4 — 封装 HyperFrames Step2→6（方案 B 模板管线，命令行端到端）** ✅ `server/src/compose/`
- `model.ts`：`capture/` → `VideoModel`（读 meta/tokens/visible-text/asset-descriptions/assets；`derivePalette` 优先站点色但强制 WCAG AA 对比守卫；`parseVisibleText`/`parseAssetDescriptions` 分桶；`layoutScenes` 按权重排时序，默认 30s）。
- `template.ts`：`VideoModel` → 单个 `index.html`（GSAP paused timeline + `data-*` 时序契约；brand/hero/showcase/value/cta 五场景；`buildTimeline` 只对实际渲染出的元素生成动画）。
- `project.ts`：写 HyperFrames 项目目录（index.html + hyperframes.json + meta.json + package.json + 拷 assets）。
- `render.ts`：封装 `hyperframes check` + `render --quality`；自动定位 winget 安装的 ffmpeg 并前置到子进程 PATH。
- `run-pipeline.ts`：`renderFromCapture`（capture → 项目 → 渲染）与 `urlToVideo`（M3 采集 + 渲染串成一条服务端流水线）。
- 新增 CLI `scripts/render-capture.ts`：`npm run render -- <captureDir|url> [--out --duration --name --quality --skip-check --ffmpeg]`（URL 模式复用 M3 全部参数）。
- **端到端验证通过**：用手搓 fixture（shadcn 品牌色 + 真实 dashboard 截图）跑 `capture/ → 模型 → 模板 → check（通过）→ render`，产出合法 **1920×1080 / 30fps / 24s / 720 帧** mp4；抽帧目检质量对齐 shadcn 调性。

**四个踩坑（已记）**：
1. **Windows PATH 大小写**：`{...process.env}` 展开后键名是 `Path`，直接写 `env.PATH` 会造成双键，子进程 `npx` 找不到；改为大小写不敏感找已有键原地前置。
2. **CRLF 解析**：`$` 锚定正则遇 `\r` 匹配失败；解析统一 `split(/\r?\n/)`。
3. **字体**：`.mono` 用 `SFMono-Regular` 不在自动解析表，报 `font_family_without_font_face`；改 `JetBrains Mono`（Google Fonts 可自动解析）。
4. **对比度 AA**：muted 灰在次背景 `#f5f5f5` 上对比 4.35<4.5 不达标；`derivePalette` 加守卫调深到 `#595959`。

### ⚠️ StepFun 视觉模型的关键结论（换模型）

实测推翻了「多模态用 `step-explore`」的假设：
- **`step-explore` 只能走 `/v1/messages` 且不支持图片输入**（喂图 400 `input_invalid`）。
- 视觉输入必须用 **`step-3.7-flash`**：它是**推理模型**，响应先产 `thinking` 块再产 `text` 块，需 `output_config.effort:"low"` 收敛思考 + 足够大的 `max_tokens`（描述用 800，Agent 决策用 1500），否则 token 全耗在 thinking 上、正文为空。
- 因此拆成两个模型：文本 `STEP_MODEL=step-explore`，视觉 `STEP_VISION_MODEL=step-3.7-flash`。`step-client.ts` 的 `callStepMessages` 增加了按调用覆盖的 `model?` 和 `effort?` 参数；`describe-assets.ts`（视觉描述）与 `ai-capture-agent.ts` 的 `askAI`（看图决策）都走视觉模型。

### 何时能在 web 页面测试？还差哪些步骤

现在**已可通过 CLI 测「URL → `capture/` → `video.mp4`」全链路**（M2+M3+M4 完成，方案 B 模板管线端到端跑通）。要在 **web 页面**里点一下就出视频，还差：

1. **后端 API**：`POST /capture`（跑 M3）+ `POST /render`（跑 M4）+ 进度/产物查询；把 `runCapture` 与 `renderFromCapture`/`urlToVideo` 包成 HTTP 服务（编排层已就绪，只差 REST 外壳）。
2. **前端接线**：现有落地页加「输入 URL → 触发 → 轮询进度 → 播放/下载视频」的交互，调上面的 API。
3. **方案 A（M5）**：LLM agent 自主 Step2→6 全保真管线 + 超时降级到方案 B；Kokoro 旁白。
4. **上服务器（M6，最后做）**：装 Chromium（`npx playwright install chromium`）、配 `.env`（`STEP_API_KEY`/`STEP_VISION_MODEL`/可选 IMAP）、部署。

一句话：**「URL → 采集 → 适配器 → 渲染 → mp4」整条链路已在本地打通并验证；剩下是把编排层包成后端 API + 前端接线，然后才上生产**。

---

## 输出契约：Agent 产物 → Capture 适配器

这是 ①②之间的**接口边界**，也是即将编写的适配器的**输入定义**。Agent 的 `capture(url)` 返回：

```ts
// src/lib/agents/ai-capture-agent.ts
export interface CaptureResult {
  screenshots: CapturedScreenshot[]   // 采集到的截图（已过滤登录/注册页）
  actions: AiAction[]                 // 每步的决策日志（调试/复现用）
}

export interface CapturedScreenshot {
  buffer: Buffer                      // PNG 原始字节
  label: string                       // Agent 起的中文说明（如「仪表盘」「补充截图 2」）
  metadata: ScreenshotMetadata
}

// src/types/capture.ts
export interface ScreenshotMetadata {
  pageUrl?: string                    // 截图时的 URL
  pageType?: "auth" | "product" | "marketing" | "onboarding"  // 推断的页面类型
  authWallSeen?: boolean              // 当时是否撞到登录墙（true 的截图其实不会被保存）
  aiDecision?: string                 // 触发这张截图的 LLM 动作，如 "click 进入仪表盘"
  captureMode?: "auth" | "capture"    // 当时处于认证阶段还是采集阶段
}
```

此外，采集过程中每一步都有一份**语义快照** `SemanticSnapshot`（见 §4.1），其 `textContent`（页面可见文字）和 `elements`（结构化元素）是 `visible-text.txt` / `tokens.json` 的原料。

### 产物 → 官方 `capture/` 的映射（适配器要做的翻译）

| 官方目标文件 | 来源（Agent 产物） | 适配器要做的事 |
|---|---|---|
| `assets/NN-<slug>.png` | `screenshots[].buffer` | 按采集顺序落盘，文件名带序号 + label slug |
| `visible-text.txt` | 各步 `snapshot.textContent` | 逐行 `[tag] 文本` 拼接（含**登录后各页**——比官方多的料） |
| `asset-descriptions.md` | `metadata.pageType` + `aiDecision` + `label` + **StepFun 多模态看图** | 每张截图一行描述；关键页用 StepFun 生成视觉级描述 |
| `tokens.json` | `snapshot`（需**小改动**补抓） | `title/description/colors/fonts/cssVariables`——见下方缺口 |

### ⚠️ 一个已知缺口（适配器落地前要补的小改动）

> ✅ **已在 M2 闭环**：见上方「实现进度」——最终方案未改 `snapshot()`，而是用 `server/src/adapter/extract-page-tokens.ts` 的自包含函数 `extractPageTokensInBrowser`，由编排器通过 `driver.evaluate()` 注入浏览器抓取品牌数据。下段保留作为背景。

`tokens.json` 需要**品牌主色 / 字体 / CSS 变量**来让视频贴合目标站调性，但当前 `snapshot()`（§4.1）只收集了可交互元素和 `textContent`，**没抓 `getComputedStyle` 的颜色/字体**。这是适配器要工作的前提，需在 `snapshot()` 里补一小段 `getComputedStyle` 采集（PRD §5 已列为「小改动」）。这是本文档 → 适配器落地之间**唯一需要动 Agent 源码**的地方，其余全是纯新增的适配器代码。

---

## 0. 架构总览与数据流

```
capture-service.ts              ← 编排：建驱动、解析凭据、跑 agent、存截图
   │
   ├── createDriver()           ← 工厂：playwright / ego-lite / mock
   │      └── PlaywrightDriver  ← 真浏览器：navigate/snapshot/screenshot/click/fill...
   │
   ├── resolveCredentials()     ← 凭据：用户账号优先，否则 IMAP 邮箱自助注册
   │      └── imap-email.ts      ← 真实邮箱收验证码/激活链接
   │
   └── new AiCaptureAgent().capture(url)   ← 核心 Agent
          每一步循环：
          screenshot() → snapshot() → 状态机判 mode(auth/capture)
          → askAI(截图+语义快照 → StepFun 多模态 LLM) → 得到 JSON 决策
          → executeAction(click/fill/navigate/press_key/verify_email/screenshot)
```

**关键设计**：Agent 不写死流程，而是「**截图 + 语义快照**」喂给多模态 LLM，让它每步返回一个 JSON 动作。外层用一个**客观信号状态机**（有没有密码框、URL 是不是登录页、有没有登出字样）决定当前处于「认证阶段」还是「采集阶段」，并给不同阶段不同的 prompt。

---

## 1. 涉及文件清单

| 文件 | 职责 |
|---|---|
| `src/lib/services/capture-service.ts` | 编排入口：建驱动、解析凭据、构造 Agent、持久化截图与步骤 |
| `src/lib/agents/ai-capture-agent.ts` | **核心**：主循环、状态机、prompt、识别、动作执行 |
| `src/lib/agents/browser-driver.ts` | 浏览器驱动抽象接口 + 工厂 |
| `src/lib/agents/playwright-driver.ts` | Playwright 真浏览器实现（截图/快照/点击/填充） |
| `src/lib/agents/credentials.ts` | 凭据解析（用户账号 / IMAP 自助注册） |
| `src/lib/agents/imap-email.ts` | IMAP 真实邮箱收验证码 / 激活链接 |
| `src/lib/agents/step-client.ts` | StepFun 多模态 LLM 调用（节流 + 重试） |
| `src/lib/agents/snapshot-parser.ts` | 语义快照 → 结构化摘要（辅助） |
| `src/types/capture.ts` | `SemanticSnapshot` / `ScreenshotMetadata` 等类型 |

---

## 2. 注册 / 登录

登录/注册分三层：**① 凭据从哪来 → ② 邮箱怎么收码 → ③ Agent 怎么填表提交**。

### 2.1 凭据解析（`credentials.ts`）

优先级：用户提供账号（登录优先）> 配了 IMAP 真实邮箱（自助注册）> 都没有（不登录，只采公开页）。

```ts
export interface AgentCredentials {
  mode: "user" | "auto"
  email: string
  password: string
  name: string
  /** 是否具备读取邮箱验证码/激活链接的能力（决定是否引导 {{code}}/verify_email） */
  canReadEmail: boolean
  /** 拉取邮箱验证码/激活链接；无邮箱读取能力时返回 null */
  fetchEmailCode: () => Promise<{ code?: string; link?: string } | null>
}

export async function resolveCredentials(project: {
  testEmail?: string | null
  testPassword?: string | null
}): Promise<AgentCredentials | null> {
  // 注册/登录提交发生在采集中后段，验证邮件那时才到；以本凭据创建时间为下界，
  // 只读此后到达的邮件，避免拿到历史旧码。
  const startedAt = Date.now()
  const imapOn = isImapConfigured()
  const imapFetch = async () =>
    readImapCode({ sinceMs: startedAt - 60_000, timeoutMs: 90_000, pollIntervalMs: 4_000 })

  // 1. 用户提供了账号 → 登录优先
  if (project.testEmail && project.testPassword) {
    return {
      mode: "user",
      email: project.testEmail,
      password: project.testPassword,
      name: randomName(),
      canReadEmail: imapOn,
      fetchEmailCode: imapOn ? imapFetch : async () => null,
    }
  }

  // 2. 配了真实 IMAP 邮箱（QQ）→ 用它自助注册（密码固定，重跑同站能转登录）
  if (imapOn) {
    const email = imapAddress()!
    const password = process.env.SIGNUP_PASSWORD || strongPassword()
    return {
      mode: "auto",
      email,
      password,
      name: randomName(),
      canReadEmail: true,
      fetchEmailCode: imapFetch,
    }
  }

  // 3. 既无用户账号也无 IMAP → 无凭据，不登录/注册
  return null
}
```

### 2.2 IMAP 真实邮箱收码（`imap-email.ts`）

用真实 `@qq.com` 邮箱（授权码登录 IMAP），能过站点「禁一次性邮箱」过滤。**收码的两个坑都在这里修掉了**：
1. IMAP `SINCE` 只精确到「天」→ 用 `internalDate` 按秒二次过滤，剔除几小时前的旧码；
2. 正文里的邮箱地址（如 `xxx@qq.com` 的号码段）会被误当验证码 → 先剔除邮箱地址、再优先匹配「关键词+6 位码」。

```ts
export async function readImapCode(
  options?: ReadOptions
): Promise<{ code?: string; link?: string } | null> {
  if (!isImapConfigured()) return null

  const timeoutMs = options?.timeoutMs ?? 90_000
  const pollIntervalMs = options?.pollIntervalMs ?? 4_000
  const since = new Date(options?.sinceMs ?? Date.now() - 5 * 60_000)
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const found = await pollOnce(since)
    if (found) return found
    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }
  return null
}

/** 建立一次连接、扫描 since 之后的新邮件、提取一次；失败返回 null 由外层重试。 */
async function pollOnce(since: Date): Promise<{ code?: string; link?: string } | null> {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST!,
    port: Number(process.env.IMAP_PORT) || 993,
    secure: (process.env.IMAP_SECURE ?? "true") !== "false",
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    logger: false,
  })

  try {
    await client.connect()
    const lock = await client.getMailboxLock("INBOX")
    try {
      // 注意：IMAP 的 SINCE 检索**只精确到「天」**，因此这一步只是粗筛，
      // 真正的时间窗过滤靠下面的 internalDate 二次比对。
      const uids = await client.search({ since }, { uid: true })
      if (!uids || uids.length === 0) return null

      // 只看最近的若干封，从最新往旧扫（验证码通常是刚到的那封）
      const recent = uids.slice(-8).reverse()
      for (const uid of recent) {
        const msg = await client.fetchOne(uid, { source: true, internalDate: true }, { uid: true })
        if (!msg || !msg.source) continue
        // 关键：用邮件真实到达时间精确过滤，剔除 SINCE 粗筛带进来的当天旧邮件。
        const arrivedAt = msg.internalDate instanceof Date ? msg.internalDate : null
        if (arrivedAt && arrivedAt.getTime() < since.getTime()) continue
        const parsed = await simpleParser(msg.source)
        const htmlText = typeof parsed.html === "string" ? parsed.html : ""
        const body = `${parsed.subject ?? ""}\n${parsed.text ?? ""}\n${htmlText}`
        const extracted = extractFromBody(body)
        if (extracted) return extracted
      }
      return null
    } finally {
      lock.release()
    }
  } catch {
    return null
  } finally {
    try { await client.logout() } catch { /* ignore */ }
  }
}

/** 从邮件正文提取验证码或激活链接。优先级：显式验证码 > 激活/确认链接。 */
export function extractFromBody(body: string): { code?: string; link?: string } | null {
  // 先剔除正文里的邮箱地址，避免把邮箱本地部分的数字误当成验证码。
  const cleaned = body.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, " ")

  // 优先：关键词上下文里的 6 位验证码（绝大多数站点验证码为 6 位）。
  const code6 = cleaned.match(/(?:code|verification|verify|otp|passcode|验证码|校验码)[^\d]{0,20}(\d{6})\b/i)
  if (code6?.[1]) return { code: code6[1] }

  // 次选：关键词上下文里的 4-8 位验证码。
  const codeContext = cleaned.match(/(?:code|verification|verify|otp|passcode|验证码|校验码)[^\d]{0,20}(\d{4,8})\b/i)
  if (codeContext?.[1]) return { code: codeContext[1] }

  // 独立的一段 6 位数字。
  const bareCode = cleaned.match(/\b(\d{6})\b/)
  if (bareCode?.[1]) return { code: bareCode[1] }

  // 激活 / 确认链接（用原始 body，保留 URL）。
  const link = body.match(/https?:\/\/[^\s"'<>]*(?:verify|confirm|activate|activation|verification)[^\s"'<>]*/i)
  if (link?.[0]) return { link: link[0] }

  return null
}
```

### 2.3 Agent 填表提交：占位符机制

LLM 在认证阶段只需回传 `fill` 动作 + 占位符（`{{email}}`/`{{password}}`/`{{name}}`/`{{code}}`），真实值由 `resolveValue` 替换 —— **LLM 永远看不到真实密码**。

```ts
/** 解析 fill 值中的占位符。返回 null 表示无需填充（如 {{code}} 只拿到链接需改为导航）。 */
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
```

动作执行分发（`executeAction` 节选，含 `verify_email` 走邮箱激活链接）：

```ts
case "fill":
  if (targetSelector && action.value) {
    const value = await this.resolveValue(action.value)
    if (value === null) break // {{code}} 只拿到激活链接，则直接导航
    await this.driver.fill(targetSelector, value)
  }
  break

case "verify_email": {
  // 无验证码输入框场景：主动去邮箱取激活链接并打开
  if (this.credentials) {
    const result = await this.credentials.fetchEmailCode()
    if (result?.link) {
      await this.driver.navigate(result.link)
      await new Promise((r) => setTimeout(r, TIMING.NAVIGATE_WAIT))
    }
  }
  break
}
```

### 2.4 AUTH 阶段 prompt（引导 LLM 怎么登录/注册）

按登录墙类型给不同指令，`code`（验证码页）是「临门一脚」的专用分支：

```ts
private buildAuthPrompt(wallKind: "password" | "passwordless" | "code" | "none") {
  const c = this.credentials

  // 验证码页：唯一任务是回填邮箱验证码完成认证
  if (wallKind === "code") {
    const guidance = `邮箱验证码阶段（临门一脚）：
本页是【邮箱验证码输入页】，站点已向注册邮箱发送了验证码。你的唯一任务是把验证码填进去并提交：
- fill 验证码输入框，value 统一用 "{{code}}"——系统会自动从邮箱读取最新验证码填入。
- 填完后 click【验证 / 确认 / 提交 / 创建账户 / 下一步】按钮，或 press_key "Enter"。`
    const rules = `1. 绝不要离开本页（不要 navigate、不要去首页/功能页），未完成验证前任务未结束。
2. 首选 action "fill"，value "{{code}}"，对准验证码输入框。
3. 验证码已填入后，click 提交/验证按钮 或 press_key "Enter"。
4. 本阶段不要截图；验证成功进入功能页后系统会自动切换到采集阶段。`
    return { phaseGoal: "输入邮箱验证码（完成认证）", guidance, rules, actionEnum: ACTION_ENUM.AUTH }
  }

  const modeLine = c?.mode === "user"
    ? "已提供测试账号，请优先寻找「登录 / Sign in / Log in」入口并登录。"
    : "未提供账号，请寻找「注册 / Sign up / Get started」入口自助注册；若只有登录页也可尝试注册链接。"

  const guidance = `登录/注册指引：
${modeLine}
填写账号表单时请使用以下占位符作为 value（系统会自动替换为真实值，请勿编造）：
- 邮箱字段：value 用 "{{email}}"
- 密码字段（含"确认密码"）：value 用 "{{password}}"
- 姓名/用户名字段：value 用 "{{name}}"
逐个字段 fill，填完后点击提交按钮或 press_key "Enter"。`

  const rules = `1. 本阶段唯一任务是**完成登录/注册**，进入功能页后系统会自动切换到采集阶段，你**不要**在本阶段截图。
2. 逐个字段 fill 账号信息（用占位符），再 click 提交按钮或 press_key "Enter"。
3. **若页面提示"邮箱已注册 / already exists"，说明注册已成功，请立刻切换到「登录」，用同一账号登录。**
4. 若出现验证码输入框，fill "{{code}}"（系统自动读取邮箱验证码）。
5. **若页面提示"已发送验证邮件 / 请查收邮件"且没有验证码输入框，返回 action "verify_email"。**
6. 不要重复完全相同的操作；一个字段填过就不要再填。`

  return { phaseGoal: "登录 / 注册（认证）", guidance, rules, actionEnum: ACTION_ENUM.AUTH }
}
```

---

## 3. 截图

### 3.1 底层截图（`playwright-driver.ts`）

**亮点**：部分站点会卡在 Playwright 的「waiting for fonts to load」，这里限时 12s，超时后**退回 CDP 直接抓当前帧**（不等字体），保证一定能截到。

```ts
async screenshot(): Promise<Buffer> {
  const page = this.getPage()
  try {
    const buf = await page.screenshot({ type: "png", fullPage: false, timeout: 12_000 })
    return Buffer.from(buf)
  } catch (err) {
    // 字体/资源迟迟不 ready 导致 Playwright 截图挂起时，退回 CDP 直接抓当前帧。
    const client = await page.context().newCDPSession(page)
    const { data } = await client.send("Page.captureScreenshot", { format: "png" })
    await client.detach().catch(() => {})
    return Buffer.from(data, "base64")
  }
}
```

### 3.2 保存 + 登录墙拦截（`ai-capture-agent.ts`）

`shootCurrent` 是唯一的保存入口：**只要此刻正对着登录墙，一律不截图**，宁可少一张也不让登录/注册页混进演示视频。

```ts
const saveShot = async (buffer: Buffer, label: string, meta: ScreenshotMetadata) => {
  const index = screenshots.length
  screenshots.push({ buffer, label, metadata: meta })
  if (this.onScreenshot) {
    try { await this.onScreenshot(buffer, label, index, meta) }
    catch (err) { logger.warn("ai_capture:on_screenshot_failed", { error: String(err) }) }
  }
}

// 登录框/注册框一律不截图，返回是否真的保存了。
const shootCurrent = async (label: string, decision?: AiAction): Promise<boolean> => {
  if (authWall) {
    logger.info("ai_capture:skip_auth_screenshot", { step, url: snapshot.url })
    return false
  }
  const metadata: ScreenshotMetadata = {
    pageUrl: snapshot.url,
    captureMode: mode,
    authWallSeen: authWall,
    aiDecision: decision ? `${decision.action} ${decision.label || ""}`.trim() : undefined,
    pageType: this.inferPageType(snapshot, authWall, loggedIn),
  }
  await saveShot(screenshotBuffer, label, metadata)
  return true
}
```

### 3.3 存盘 + 实时进度（`capture-service.ts` 的 onScreenshot 回调）

每存一张就写库 + WebSocket 推进度：

```ts
onScreenshot: async (buffer, label, index, metadata) => {
  const filePath = await saveScreenshot(projectId, index, buffer)
  await prisma.screenshot.create({
    data: {
      captureSessionId: sessionId,
      filePath, label, stepIndex: index,
      pageUrl: metadata.pageUrl ?? null,
      pageType: metadata.pageType ?? null,
      authWallSeen: metadata.authWallSeen ?? false,
      aiDecision: metadata.aiDecision ?? null,
      captureMode: metadata.captureMode ?? null,
    },
  })
  screenshotCount = index + 1
  emitCaptureProgress(projectId, screenshotCount, 8, label, filePath)
},
```

### 3.4 兜底：截图不足时回入口采公开页

登录失败时也不输出空产物 —— 回入口页滚动采公开内容（仍不保存登录页）：

```ts
if (screenshots.length < this.minScreenshots) {
  await this.driver.navigate(url)
  const sweepMax = 5
  for (let i = 0; i < sweepMax && screenshots.length < this.minScreenshots; i++) {
    const sweepSnap = await this.driver.snapshot()
    const sweepBuf = await this.driver.screenshot()
    if (sweepSnap && this.isAuthWall(sweepSnap)) {
      // 跳过登录墙
    } else {
      await saveShot(sweepBuf, `补充截图 ${screenshots.length + 1}`, { /* meta */ })
    }
    await this.driver.scroll("down")
  }
}
```

---

## 4. 识别（页面类型 / 登录墙 / 已登录）

识别分两条腿：**① 客观信号（DOM/URL 关键词）** 做状态机主判据；**② LLM 看图** 做已登录兜底判断。

### 4.1 语义快照：把页面「翻译」成结构化元素（`playwright-driver.ts`）

给每个可交互元素打上稳定的 `data-fp-ref`，供 LLM 用编号回传定位，避免 LLM 编造 selector。

```ts
async snapshot(): Promise<SemanticSnapshot> {
  const page = this.getPage()
  const title = await page.title()
  const url = page.url()

  const elements = await page.evaluate(() => {
    const selectors = "button, a, input, textarea, select, h1, h2, h3, img, [role='button'], [contenteditable='true']"
    const nodes = document.querySelectorAll(selectors)
    const result: Array<Record<string, unknown>> = []
    let ref = 0
    nodes.forEach((el) => {
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      const tag = el.tagName.toLowerCase()
      const hidden = style.display === "none" || style.visibility === "hidden" || (rect.width === 0 && rect.height === 0)
      if (hidden && tag !== "img") return
      el.setAttribute("data-fp-ref", String(ref)) // 打上稳定引用，供 click/fill 精确定位
      const inputType = tag === "input" ? (el.getAttribute("type") || "text") : undefined
      // ... 收集 name / placeholder / role / text / bounds
      result.push({ ref, tag, role, text, type: inputType, name, placeholder,
        selector: `[data-fp-ref="${ref}"]`, bounds: { /* x,y,w,h */ } })
      ref++
    })
    return result
  })

  const textContent = await page.evaluate(() => document.body?.innerText || "")
  return { title, url, elements, textContent }
}
```

### 4.2 登录墙类型识别（核心识别逻辑）

区分 4 种：`password`（账密框）/ `passwordless`（邮箱先行）/ `code`（验证码页）/ `none`。关键词表在文件顶部定义。

```ts
private authWallKind(snapshot: SemanticSnapshot): "password" | "passwordless" | "code" | "none" {
  const hasPassword = snapshot.elements.some((e) => e.type === "password")
  const hay = `${snapshot.url || ""} ${snapshot.title || ""} ${snapshot.textContent || ""}`.toLowerCase()

  // 邮箱验证码页：无密码框，但处于 verify 路径 / 正文提示验证码，且有可填输入框。
  // 优先判定，因为它是「注册/登录提交后」的专属环节。
  if (!hasPassword && this.isVerifyCodePage(snapshot)) return "code"

  // 账密墙：有密码框 + 认证关键词
  if (hasPassword && AUTH_KEYWORDS.some((k) => hay.includes(k))) return "password"

  // 无密码墙：仅依据 URL/标题判定是否确实在认证页，避免带登录链接的营销首页误判
  const locus = `${snapshot.url || ""} ${snapshot.title || ""}`.toLowerCase()
  if (AUTH_PATH_KEYWORDS.some((k) => locus.includes(k))) {
    const hasEmailInput = snapshot.elements.some((e) =>
      e.type === "email" ||
      (e.tag === "input" && EMAIL_FIELD_RE.test(`${e.name || ""} ${e.placeholder || ""}`.toLowerCase())))
    const hasTextInput = snapshot.elements.some((e) =>
      e.tag === "input" && (!e.type || e.type === "text" || e.type === "email"))
    if (hasEmailInput || hasTextInput) return "passwordless"
  }
  return "none"
}
```

### 4.3 验证码页识别

```ts
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
```

### 4.4 登录入口 / 已登录识别

```ts
/** 页面是否存在登录/注册入口（链接或按钮文案命中认证入口关键词） */
private hasAuthEntry(snapshot: SemanticSnapshot): boolean {
  return snapshot.elements.some((e) => {
    const isClickable = e.role === "button" || e.role === "link" || e.tag === "a" || e.tag === "button"
    if (!isClickable) return false
    const label = `${e.text || ""} ${e.name || ""}`.toLowerCase()
    if (!label.trim()) return false
    return AUTH_ENTRY_KEYWORDS.some((k) => label.includes(k))
  })
}

/** 是否已登录：无密码框 且 出现登出/控制台等强信号（只认显式登出，避免误判） */
private looksLoggedIn(snapshot: SemanticSnapshot): boolean {
  const hasPassword = snapshot.elements.some((e) => e.type === "password")
  if (hasPassword) return false
  const hay = `${snapshot.url || ""} ${snapshot.title || ""} ${snapshot.textContent || ""}`.toLowerCase()
  return LOGGED_IN_KEYWORDS.some((k) => hay.includes(k))
}
```

### 4.5 关键词表（识别的「字典」，文件顶部）

```ts
const AUTH_KEYWORDS = ["login","log in","sign in","signin","sign-in","register","sign up","signup","sign-up","auth","登录","注册","登入"]
// 已登录只认「显式登出控件」这类强信号，避免营销页的 dashboard/设置 等词误判
const LOGGED_IN_KEYWORDS = ["logout","log out","sign out","登出","退出登录","注销","退出账户"]
const AUTH_PATH_KEYWORDS = ["login","log-in","signin","sign-in","signup","sign-up","register","/auth","登录","注册","登入"]
const AUTH_ENTRY_KEYWORDS = ["login","log in","sign in","signin","sign up","signup","sign-up","register","get started","登录","注册","登入","免费注册","开始使用","免费试用"]
const EMAIL_FIELD_RE = /email|e-mail|邮箱|邮件/
const VERIFY_PATH_KEYWORDS = ["email-verify","verify-email","verify","verification","activate","activation","confirm-email","confirm","验证邮箱","邮箱验证"]
const VERIFY_TEXT_KEYWORDS = ["输入验证码","查收邮件","验证您的邮箱","验证你的邮箱","验证并创建","verification code","enter the code","enter code","check your email","we sent","we've sent","已发送验证码","发送到您的邮箱","6 位验证码","6位验证码"]
const CODE_FIELD_RE = /\bcode\b|otp|verif|passcode|验证码|校验码/i
```

### 4.6 LLM 看图判登录（比关键词更可靠）

prompt 里让 LLM 每步回传 `loggedIn`，Agent 采纳它作为兜底信号：

```ts
// prompt JSON 模板里追加：
// "loggedIn": 布尔值（看当前截图判断：若页面显示已登录——出现账号头像/用户名/邮箱、
//             后台侧边导航、退出登录、仪表盘等——填 true；仍是登录/注册/营销页则 false）

// 主循环里采纳：
if (typeof decision.loggedIn === "boolean") {
  this.llmLoggedIn = decision.loggedIn
  if (decision.loggedIn && !authWall && !this.authCompleted) {
    this.authCompleted = true
    logger.info("ai_capture:auth_success_by_llm", { step, url: snapshot.url })
  }
}
```

---

## 5. 主循环状态机

每步：截图 → 快照 → 派生 mode → 问 AI → 执行。核心是 `wantAuth` / `mode` 的推导。

```ts
for (let step = 0; step < this.maxSteps; step++) {
  const screenshotBuffer = await this.driver.screenshot()
  const snapshot = await this.driver.snapshot()

  // ---- 外层状态机：根据客观信号派生当前 mode ----
  const wallKind = this.authWallKind(snapshot)
  const authWall = wallKind !== "none"
  // 已登录信号：关键词启发式 OR LLM 上一步看图的判断
  const loggedIn = this.looksLoggedIn(snapshot) || this.llmLoggedIn
  const hasAuthEntry = this.hasAuthEntry(snapshot)

  // authWall 是比 loggedIn 关键词更强的"当前时刻"信号：撞墙就说明此刻未登录 → 撤销误判
  if (authWall) {
    this.authCompleted = false
  } else if (loggedIn && !this.authCompleted) {
    this.authCompleted = true
  }

  // 验证码页即使 authBudget 耗尽，也给额外的 codeSteps 预算去回填验证码（临门一脚）
  const isCodePage = wallKind === "code"
  const CODE_BUDGET = 4
  const wantAuth =
    !this.authCompleted &&
    !!this.credentials &&
    (this.authSteps < this.authBudget || (isCodePage && this.codeSteps < CODE_BUDGET))
  // 当前是登录墙、或页面有登录入口，且还想认证 → 进 auth，否则 capture
  const mode: CaptureMode = wantAuth && (authWall || hasAuthEntry) ? "auth" : "capture"

  const decision = await this.askAI(screenshotBuffer, snapshot, { mode, ... })

  // 采纳 LLM 的 loggedIn 判断（见 4.6）...

  // 完成条件（仅 capture 阶段）
  if (mode === "capture" && (decision.action === "done" || screenshots.length >= this.maxScreenshots)) {
    await shootCurrent(...); break
  }

  // 死循环保护：连续 3 次相同动作签名 → 强制滚动换策略
  const sig = `${decision.action}:${decision.ref ?? decision.selector ?? ""}:${decision.value ?? ""}`
  recentSignatures.push(sig)
  if (recentSignatures.length === 3 && recentSignatures.every((s) => s === sig)) {
    await this.driver.scroll("down")
    recentSignatures.length = 0
    if (mode === "auth") { this.authSteps++; if (isCodePage) this.codeSteps++ }
    continue
  }

  await this.executeAction(decision, lastSnapshot)
  if (mode === "auth") { this.authSteps++; if (isCodePage) this.codeSteps++ }
}
```

**Agent 实例字段（状态）**：

```ts
private visitedUrls = new Set<string>()
private authSteps = 0        // 认证已花步数
private codeSteps = 0        // 验证码页专用步数（绕过 authBudget）
private llmLoggedIn = false  // LLM 上一步看图判定的登录状态
private authCompleted = false
```

**Agent 构造参数（`capture-service.ts` 传入）**：

```ts
const agent = new AiCaptureAgent(driver, {
  maxSteps: 24,
  minScreenshots: 4,
  maxScreenshots: 8,
  authBudget: 10,
  credentials: credentials ?? undefined,
  description: project.description,
  onScreenshot: async (buffer, label, index, metadata) => { /* 存库+推进度，见 3.3 */ },
  onStep: async (step, action) => { /* 写步骤日志 */ },
})
await agent.capture(project.url)
```

---

## 6. LLM 多模态调用

### 6.1 组装请求（`ai-capture-agent.ts`）

把「截图 base64 + 文字 prompt」一起发给多模态模型，只要 JSON。**注意 `model`/`effort`**：`step-explore` 不吃图，看图决策必须走视觉模型 `step-3.7-flash`（推理模型，先 thinking 再 text），并给足 `max_tokens`：

```ts
private async askAI(screenshot: Buffer, snapshot, context): Promise<AiAction> {
  const base64 = screenshot.toString("base64")
  const prompt = this.buildStepPrompt(snapshot, context)

  const content = await callStepMessages({
    model: this.visionModel,   // STEP_VISION_MODEL || "step-3.7-flash"
    effort: "low",             // 收敛 thinking，避免吃光正文 token
    system: "你是一个网页浏览 Agent，负责主动登录/注册并采集产品核心功能截图。只返回 JSON，不要其他文字。",
    maxTokens: 1500,
    content: [
      { type: "text", text: prompt },
      { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
    ],
  })

  const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
  return parseLlmJson<AiAction>(jsonStr, { action: "scroll", value: "down", label: "降级滚动" })
}
```

### 6.2 底层调用：节流 + 重试（`step-client.ts`）

StepFun API 有 RPM 限制（约 10 次/分），因此**全局串行队列 + 最小间隔节流（默认 7s/次） + 429/5xx 退避重试**。采集 Agent 与分镜生成共用本模块，避免互相挤爆限速。

```ts
let lastCallAt = 0
let queue: Promise<unknown> = Promise.resolve()

export function callStepMessages(opts: StepMessageOptions): Promise<string> {
  const run = queue.then(() => doCall(opts))
  queue = run.then(() => {}, () => {}) // 无论成败都让队列继续
  return run
}

async function doCall(opts: StepMessageOptions): Promise<string> {
  const { apiKey, baseURL } = getConfig()
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt) // 最小间隔节流
    if (wait > 0) await sleep(wait)
    lastCallAt = Date.now()

    const res = await fetch(`${baseURL}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: opts.model || MODEL, max_tokens: opts.maxTokens, system: opts.system,
        messages: [{ role: "user", content: opts.content }],
        ...(opts.effort ? { output_config: { effort: opts.effort } } : {}) }),  // 推理模型收敛思考
    })

    if (res.ok) {
      const data = await res.json()
      return data.content?.find((c) => c.type === "text")?.text || ""
    }
    // 429 限速 / 5xx 服务端异常：退避重试
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(res.status === 429 ? 12_000 : 4_000)
      continue
    }
    throw new Error(`StepFun API ${res.status}`)
  }
  throw new Error("StepFun API: exhausted retries")
}
```

### 6.3 LLM 返回的动作结构（`AiAction`）

```ts
export interface AiAction {
  action: "click" | "fill" | "scroll" | "screenshot" | "navigate" | "press_key" | "verify_email" | "done"
  ref?: number       // 目标元素引用编号（来自 snapshot 的 ref）
  selector?: string  // 兜底选择器
  value?: string     // fill 内容（支持占位符）/ scroll 方向 / navigate URL / press_key 按键
  label?: string
  reason?: string
  loggedIn?: boolean // LLM 看图判断的登录状态
}
```

---

## 附：环境变量

```
BROWSER_DRIVER=playwright        # playwright / mock
STEP_API_KEY=...                 # StepFun LLM
STEP_MODEL=step-explore          # 文本模型
STEP_VISION_MODEL=step-3.7-flash # 视觉模型（看图决策/截图描述；step-explore 不吃图）
STEP_MIN_INTERVAL_MS=7000        # 调用最小间隔（节流）
IMAP_HOST=imap.qq.com            # 真实邮箱收码
IMAP_PORT=993
IMAP_SECURE=true
IMAP_USER=<你的邮箱>
IMAP_PASSWORD=<QQ邮箱授权码>      # 不是登录密码！
SIGNUP_PASSWORD=<自助注册用的固定密码>
```
