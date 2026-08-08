# Local Script Video CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** 将 PurpleInk 收敛为一个读取文稿、调用用户自有 OpenAI-compatible API、受控并发生成镜头代码、渲染并验证 MP4 的本地 CLI。

**Architecture:** 新增 packages/script-video-cli workspace 包，内部按 contracts、input、ai、state、workflow、render、qa、commands 分层；默认文件状态，StateStore 预留可选 PostgreSQL 实现。CLI 不依赖 Next、server-only、Drizzle、认证、计费、网站采集或音频来源项目；现有 HyperFrames/FFmpeg 适配器只在新 CLI smoke 通过后迁入或收口。

**Tech Stack:** TypeScript strict、Node.js >=22、pnpm 10.30.0、Zod、Vitest、Playwright、HyperFrames 0.7.70、FFmpeg/ffprobe。

---

### Task 1: 建立 CLI 包边界

**Files:**
- Modify: pnpm-workspace.yaml, package.json
- Create: packages/script-video-cli/package.json
- Create: packages/script-video-cli/tsconfig.json
- Create: packages/script-video-cli/src/index.ts
- Test: packages/script-video-cli/src/index.test.ts

- [ ] **Step 1: 写失败测试**

测试从 CLI 包入口导入 CLI_VERSION 和 createCli，并断言版本为 script-video-cli-v1、名称为 purpleink-video。

- [ ] **Step 2: 运行测试确认失败**

Run: pnpm exec vitest run packages/script-video-cli/src/index.test.ts
Expected: 缺少 package/source 导致 FAIL。

- [ ] **Step 3: 写最小实现**

package.json 的 bin 指向 dist/cli.js，脚本包含 build、typecheck、test；root package 增加 cli、cli:check、cli:test。index.ts 导出稳定版本常量和 createCli(): { name: 'purpleink-video'; version: string }。workspace 把 packages/* 纳入。

- [ ] **Step 4: 验证并提交**

Run: pnpm exec vitest run packages/script-video-cli/src/index.test.ts; pnpm --filter @purpleink/script-video-cli typecheck
Expected: PASS、exit 0。

~~~powershell
git add pnpm-workspace.yaml package.json packages/script-video-cli
git diff --cached --check
git commit -m "feat(cli): add script video package boundary"
~~~

---

### Task 2: 建立 script-video.v1 输入合同

**Files:**
- Create: packages/script-video-cli/src/contracts.ts
- Create: packages/script-video-cli/src/input.ts
- Test: packages/script-video-cli/src/input.test.ts

- [ ] **Step 1: 写失败测试**

覆盖 Markdown 的一级标题和二级单元、JSON 与 Markdown 等价规范化、重复 U001、空文本、未知 JSON 字段、时长 5–600 秒边界和原始 UTF-8 SHA-256。

- [ ] **Step 2: 运行测试确认失败**

Run: pnpm exec vitest run packages/script-video-cli/src/input.test.ts
Expected: 缺少 parseScriptText、parseScriptValue 导致 FAIL。

- [ ] **Step 3: 写严格 schema 和解析器**

contracts.ts 定义 scriptUnitSchema、scriptVideoInputSchema、narrationModeSchema；JSON object 使用 strict；unit ID 只接受 U 加三位数字；Markdown 为每个非空二级标题正文分配递增 ID，不发明正文。input.ts 暴露 parseScriptText、parseScriptValue、readScriptFile、hashSourceBytes。

- [ ] **Step 4: 验证并提交**

Run: pnpm exec vitest run packages/script-video-cli/src/input.test.ts; rg -n "\uFFFD" packages/script-video-cli
Expected: focused tests PASS，U+FFFD 无命中。

~~~powershell
git add packages/script-video-cli/src/contracts.ts packages/script-video-cli/src/input.ts packages/script-video-cli/src/input.test.ts
git diff --cached --check
git commit -m "feat(cli): validate script video input contract"
~~~

---

### Task 3: 通用 AI client 和有界并发

**Files:**
- Create: packages/script-video-cli/src/ai/openai-compatible.ts
- Create: packages/script-video-cli/src/ai/concurrency.ts
- Test: packages/script-video-cli/src/ai/openai-compatible.test.ts
- Test: packages/script-video-cli/src/ai/concurrency.test.ts

- [ ] **Step 1: 写失败测试**

用本地 fake HTTP server 断言 POST /chat/completions、model、消息结构、JSON 响应解析、429/5xx 重试和凭据不出现在错误中；用 10 个任务和 limit=3 断言最大同时任务不超过 3。

- [ ] **Step 2: 运行测试确认失败**

Run: pnpm exec vitest run packages/script-video-cli/src/ai
Expected: 缺少 client/pool 导致 FAIL。

- [ ] **Step 3: 实现协议适配器**

OpenAiCompatibleConfig 包含 baseUrl、apiKey、textModel、visionModel、requestTimeoutMs、maxRetries。AiClient 暴露 completeText 和 completeJson；使用标准 chat completions、AbortSignal.timeout、参数数组，错误只允许 AI_CONFIG_INVALID、AI_TIMEOUT、AI_RATE_LIMITED、AI_PROVIDER_UNAVAILABLE。

- [ ] **Step 4: 实现 Promise pool**

mapWithConcurrency(items, limit, worker, options) 限制 1–32；只对 429、5xx、网络超时重试，指数退避带上限和 jitter；取消后不再开始新任务；每个 item 只返回一次最终结果。

- [ ] **Step 5: 验证并提交**

Run: pnpm exec vitest run packages/script-video-cli/src/ai; pnpm --filter @purpleink/script-video-cli typecheck
Expected: PASS、typecheck PASS。

~~~powershell
git add packages/script-video-cli/src/ai
git diff --cached --check
git commit -m "feat(cli): add compatible AI client and concurrency pool"
~~~

---

### Task 4: 原子文件状态和恢复

**Files:**
- Create: packages/script-video-cli/src/state/store.ts
- Create: packages/script-video-cli/src/state/file-store.ts
- Create: packages/script-video-cli/src/state/run-id.ts
- Modify: packages/script-video-cli/src/contracts.ts
- Test: packages/script-video-cli/src/state/file-store.test.ts

- [ ] **Step 1: 写失败测试**

覆盖 run 目录唯一性、JSON 临时文件后 rename、events.jsonl 追加、不同输入 hash 拒绝 resume、已完成 S001 不重跑而失败 S002 可重跑。

- [ ] **Step 2: 实现 StateStore**

接口包含 createRun、readRun、writeStage、readStage、appendEvent、writeArtifact。每次写入使用临时文件和 rename，每次读取用 Zod 校验；状态只存相对 storage key，输出时再解析绝对路径。

- [ ] **Step 3: 实现 run ID 和恢复**

runId 使用 UTC 时间戳加输入 hash 前 12 位；resume 校验 inputHash、workflowVersion 和合同 fingerprint。状态目录固定为 state/run.json、state/events.jsonl、state/units、state/shots/S001/attempt-001。

- [ ] **Step 4: 验证并提交**

Run: pnpm exec vitest run packages/script-video-cli/src/state; pnpm --filter @purpleink/script-video-cli typecheck
Expected: PASS。

~~~powershell
git add packages/script-video-cli/src/contracts.ts packages/script-video-cli/src/state
git diff --cached --check
git commit -m "feat(cli): add crash-safe local run state"
~~~

---

### Task 5: INGEST/DIRECT/SHOT-SPEC 工作流

**Files:**
- Create: packages/script-video-cli/src/workflow/prompts.ts
- Create: packages/script-video-cli/src/workflow/plan.ts
- Test: packages/script-video-cli/src/workflow/plan.test.ts

- [ ] **Step 1: 写失败测试**

fake AiClient 返回 master plan、style bible 和每个 unit 一个 shot；测试源 unit 绑定、确定性 shot ID、禁止新增事实、畸形 JSON 映射为 AI_OUTPUT_INVALID。

- [ ] **Step 2: 定义 strict 合同和 prompts**

定义 DirectorPlan、StyleBible、ShotPlan schema；prompt 明确每镜只绑定已有 U###，不得扩写原文事实，必须返回可验证 JSON；解析后再次验证 sourceUnitId 属于输入。

- [ ] **Step 3: 实现顺序阶段**

createPlan 先持久化 INGEST，然后执行一次 DIRECT、每个 unit 一次 SHOT-SPEC；每阶段完成后写状态和事件。resume 时只复用 fingerprint 匹配且 schema 有效的阶段。

- [ ] **Step 4: 验证并提交**

Run: pnpm exec vitest run packages/script-video-cli/src/workflow/plan.test.ts
Expected: PASS。

~~~powershell
git add packages/script-video-cli/src/workflow/prompts.ts packages/script-video-cli/src/workflow/plan.ts packages/script-video-cli/src/workflow/plan.test.ts
git diff --cached --check
git commit -m "feat(cli): add script director and shot planning"
~~~

---

### Task 6: 并发镜头 codegen 与门禁

**Files:**
- Create: packages/script-video-cli/src/workflow/codegen.ts
- Create: packages/script-video-cli/src/workflow/gates.ts
- Create: packages/script-video-cli/src/workflow/fixtures/valid-shot.html
- Create: packages/script-video-cli/src/workflow/fixtures/invalid-shot.html
- Test: packages/script-video-cli/src/workflow/codegen.test.ts

- [ ] **Step 1: 写失败测试**

验证 limit 不超出、每镜独立 attempt 目录、HTML 越过 output root 被拒绝、远程 script/src 被拒绝、凭据样式字符串被拒绝、失败镜头不会把 run 标记为 succeeded。

- [ ] **Step 2: 实现 codegen**

对每个 ShotPlan 并发调用 AI，要求完整 HTML、paused timeline、window.__PURPLEINK_RENDER__ 元数据、无网络资源、只使用源 unit 事实；写入 shots/Sxxx/attempt-N/source.html 和 result.json。

- [ ] **Step 3: 实现静态和 Chromium gate**

静态检查 HTML 可解析、metadata.ready 合同、无 http(s) 资源、无 credential pattern、源大小上限和 seed 声明。Chromium 打开本地文件，在 0%、50%、100% seek，等待 ready，记录 console/page 错误和截图 hash；原始模型文本不算成功证据。

- [ ] **Step 4: 验证并提交**

Run: pnpm exec vitest run packages/script-video-cli/src/workflow/codegen.test.ts; pnpm --filter @purpleink/script-video-cli typecheck
Expected: PASS。

~~~powershell
git add packages/script-video-cli/src/workflow/codegen.ts packages/script-video-cli/src/workflow/gates.ts packages/script-video-cli/src/workflow/fixtures packages/script-video-cli/src/workflow/codegen.test.ts
git diff --cached --check
git commit -m "feat(cli): generate and gate shots concurrently"
~~~

---

### Task 7: 合成、旁白/字幕、渲染和媒体 QA

**Files:**
- Create: packages/script-video-cli/src/workflow/assemble.ts
- Create: packages/script-video-cli/src/render/hyperframes.ts
- Create: packages/script-video-cli/src/qa/media.ts
- Test: packages/script-video-cli/src/workflow/assemble.test.ts
- Test: packages/script-video-cli/src/qa/media.test.ts

- [ ] **Step 1: 写失败测试**

fixture shots 断言根 composition 只引用本地镜头且顺序稳定；narration off 不调用 TTS；auto 缺配置输出显式 degraded；manifest 中 hash/size 与真实字节相等。

- [ ] **Step 2: 实现 assemble**

写 composition/index.html、hyperframes.json、meta.json；根 composition 只引用已通过 gate 的 shot；字幕由规范化 units 派生。narration off 跳过；auto 缺 TTS 标记 degraded；required 缺配置直接失败。

- [ ] **Step 3: 实现 renderer**

解析固定 workspace HyperFrames binary，FFmpeg 从显式目录、env 或 PATH 解析；使用 spawn 参数数组，不把用户字符串拼入 shell；先 check 后 render，支持取消和超时；禁止生成 npx --yes 动态下载脚本。

- [ ] **Step 4: 实现 media QA**

ffprobe 用参数数组检查 MP4、大小、时长容差、分辨率、帧率；最终字节计算 SHA-256，写入不可变 artifact record。

- [ ] **Step 5: 验证并提交**

Run: pnpm exec vitest run packages/script-video-cli/src/workflow/assemble.test.ts packages/script-video-cli/src/qa/media.test.ts
Expected: PASS。

~~~powershell
git add packages/script-video-cli/src/workflow/assemble.ts packages/script-video-cli/src/render packages/script-video-cli/src/qa
git diff --cached --check
git commit -m "feat(cli): assemble render and verify video artifacts"
~~~

---

### Task 8: agent-facing CLI commands

**Files:**
- Create: packages/script-video-cli/src/cli.ts
- Create: packages/script-video-cli/src/commands/run.ts
- Create: packages/script-video-cli/src/commands/plan.ts
- Create: packages/script-video-cli/src/commands/status.ts
- Create: packages/script-video-cli/src/commands/doctor.ts
- Test: packages/script-video-cli/src/cli.test.ts
- Create: examples/script-video/quickstart.md
- Create: docs/cli/script-video-agent-contract.md
- Modify: packages/script-video-cli/src/index.ts

- [ ] **Step 1: 写失败 CLI 合同测试**

断言 --help、缺位置参数退出码 2、plan --json 输出一个无 secret 的 JSON、status --json 读取状态、run --json 输出绝对 manifest/video 路径。

- [ ] **Step 2: 实现 parser 和退出码**

用 process.argv 的小型 parser；0 成功、1 工作流/验证失败、2 用法/配置错误；设置 process.exitCode，不直接 process.exit，确保 stdout drain。

- [ ] **Step 3: 实现命令**

run 加载 env/config，解析输入，创建或恢复 run，执行 plan→codegen→assemble→render→QA；plan 在 SHOT-SPEC 后停止；status 只读；doctor 检查 Node、HyperFrames、Chromium、FFmpeg 和 provider 是否 configured，只输出布尔值。

- [ ] **Step 4: 写 agent 合同**

文档固定命令、JSON 输出、环境变量 SCRIPT_VIDEO_AI_BASE_URL/SCRIPT_VIDEO_AI_API_KEY/SCRIPT_VIDEO_AI_MODEL/SCRIPT_VIDEO_TTS_*、resume、并发、错误码和 secret 禁止事项。

- [ ] **Step 5: 验证并提交**

Run: pnpm exec vitest run packages/script-video-cli/src/cli.test.ts; pnpm --filter @purpleink/script-video-cli build
Expected: PASS。

~~~powershell
git add packages/script-video-cli/src packages/script-video-cli/package.json examples/script-video docs/cli pnpm-workspace.yaml package.json pnpm-lock.yaml
git diff --cached --check
git commit -m "feat(cli): expose agent-friendly script video commands"
~~~

---

### Task 9: 真实本地 smoke

**Files:**
- Create: packages/script-video-cli/scripts/smoke.ps1
- Create: packages/script-video-cli/src/smoke.test.ts
- Modify: README.md
- Modify: packages/script-video-cli/README.md

- [ ] **Step 1: 加 fixture provider smoke**

用 provider=fixture 证明 run 创建、resume 不重生成成功镜头、input hash 改变被拒绝；fixture 只在测试/本地 smoke 可见，不在生产默认路径。

- [ ] **Step 2: 加真实 HyperFrames smoke**

脚本在仓库内创建自己负责的临时目录，运行 quickstart 的 plan/run/status，检查 manifest、MP4、SHA-256、ffprobe 和 U+FFFD；不清理既有 out/ 或用户文件。

- [ ] **Step 3: 运行并记录证据**

Run: powershell -NoProfile -ExecutionPolicy Bypass -File packages/script-video-cli/scripts/smoke.ps1
Expected: exit 0、succeeded、MP4 > 0、视频流可读。

- [ ] **Step 4: 提交**

~~~powershell
git add packages/script-video-cli/scripts packages/script-video-cli/README.md README.md
git diff --cached --check
git commit -m "test(cli): prove local script video smoke path"
~~~

---

### Task 10: 删除非文稿视频运行时

**Files:**
- Create: docs/cli/legacy-removal-audit.md
- Test: packages/script-video-cli/src/legacy-surface.test.ts
- Delete only exact paths classified by the audit under src/app, src/components, non-script src/features, root API routes, website/audio-source/capture/server API modules, and billing/auth schema/migrations
- Modify: package.json, pnpm-workspace.yaml, tsconfig.json, docker-compose.dev.yml, docker-compose.prod.yml, README.md

- [ ] **Step 1: 先做引用盘点**

Run: rg -n -i "billing|entitlement|redemption|subscription|website|audio-transcribe|capture-url|render-capture|next|drizzle|postgres|auth|workspace" package.json pnpm-workspace.yaml src server scripts docs README.md
将每个命中分类为 CLI 保留、迁移文档、可删除，并写入 audit；删除前验证每个目标路径属于分类结果。

- [ ] **Step 2: 加负向合同测试**

测试 public package scripts/help 不包含 billing、auth、website、audio-source、managed-provider；script-video 的 run/plan/status/doctor 保持存在。

- [ ] **Step 3: 删除并简化依赖**

CLI smoke 通过后删除分类的旧运行时和入口；保留真正被 CLI 使用的 Zod、Playwright、HyperFrames、FFmpeg、procedural-sfx；不删除 .env、out、浏览器缓存和无关未跟踪文件；pnpm-lock.yaml 只用 pnpm install 生成。

- [ ] **Step 4: 验证并提交**

Run: pnpm install; pnpm --filter @purpleink/script-video-cli typecheck; pnpm exec vitest run packages/script-video-cli/src/legacy-surface.test.ts
Expected: CLI PASS、负向扫描无命中。

~~~powershell
git add -u src server scripts package.json pnpm-workspace.yaml tsconfig.json docker-compose.dev.yml docker-compose.prod.yml README.md
git add packages/script-video-cli docs/cli pnpm-lock.yaml
git diff --cached --name-status
git diff --cached --check
git commit -m "refactor(cli): remove non-script product runtime"
~~~

---

### Task 11: 最终门禁和数据库决策交付

**Files:**
- Create: docs/cli/database-decision.md
- Create: docs/cli/validation-report.md
- Modify: AGENTS.md only where the CLI boundary changed

- [ ] **Step 1: 运行完整本地门禁**

Run:
~~~powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm verify:v3
pnpm build
git diff --check
rg -n "\uFFFD" AGENTS.md README.md docs src server scripts packages
~~~
Expected: 每项记录真实 exit code；旧 Web 门禁已删除时记录等价 CLI 命令，不伪称旧命令执行。

- [ ] **Step 2: 运行 CLI 证据序列**

依次运行 doctor --json、plan --json、run --json、status --json 和 resume smoke；只记录状态、计数、绝对路径、字节数、hash、ffprobe 字段和测试数量。

- [ ] **Step 3: 写数据库决策**

说明文件状态为何满足单机并发，何时切换 Postgres，以及五表可选 StateStore 合同；记录 Docker Postgres 不是默认依赖。

- [ ] **Step 4: 检查 worktree 和 staged secret**

Run: git status --short --branch; git diff --cached --name-status; git log --oneline -12; git diff --check
确认没有 .env*、凭据、浏览器临时目录、构建产物、输出视频或 U+FFFD 被 stage。

- [ ] **Step 5: 提交并收尾**

~~~powershell
git add AGENTS.md docs/cli
git diff --cached --check
git commit -m "docs(cli): record database choice and validation evidence"
~~~

仅当 CLI 真正接受文稿、受控并发 codegen、resume、生成哈希校验 MP4，且公开运行时不再包含计费/认证/网站/音频来源路径时标记 Goal complete。
