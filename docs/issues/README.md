# PurpleInk 工作流—画布体系 Issue 索引

本目录是「前端工作流画布 + Director 智能体管线」的问题拆解与定向修复入口。
每个 ISSUE 文件自带证据、修复范围、验收标准与禁区，可独立派发给不同执行者。

- 撰写日期：2026-07-25
- 审查基线：`c6704da docs: rewrite the routing convention and AGENTS, add src/app README`
- 上游真值：`AGENTS.md`、`docs/conventions/routing.md`、`docs/designs/canvas.pen`

## 0. 范围边界（先读这一节）

本仓库存在**两套互不相同的智能体系统**。本目录**只覆盖第一套**。

| | 前端画布 Director（本目录范围） | 后端独立智能体（**不在范围内**） |
| --- | --- | --- |
| 代码位置 | `src/features/director/**` | `server/src/**` |
| 框架 | pi-agent（`@earendil-works/pi-agent-core` + `pi-ai`） | 自有实现（`capture/ai-capture-agent.ts`、`lib/step-client.ts`） |
| 输入 | **纯文本稿件**（`projects.script`） | **必须是 URL**（`server/src/server/api.ts:98` 强校验 http/https） |
| 渲染 | Playwright 逐帧 seek + `ffmpeg-static` | `hyperframes` CLI |
| 音频 | StepFun `stepaudio-2.5-tts`（`src/features/audio/**`） | ListenHub FlowSpeech（`server/src/tts/**`） |
| 编排 | 画布 DAG + `src/lib/queue` 进程内队列 | `server/src/server/job-store.ts` 内存 job + 单进程串行 |
| 节流/重试 | 无（见 ISSUE-004） | `step-client.ts` 自有串行队列 + 重试 |

**硬边界，任何 ISSUE 都不得跨越：**

1. 不修改 `server/**` 的任何文件。
2. 不把两套的 model routing、凭据解析、env 加载器、job 状态机、进度阶段枚举合并或互相 import。
3. 两套各自持有 `JobPhase` 是**合法重复**，由 `tests/job-phase-contract.test.ts` 锁契约，不要"消除重复"。
4. 后端那套已经能出真实成片（证据：`server/out/cache/localhost-video/`，含 4 段 mp3 + `narration.wav` + 3 组 mp4），它是可工作资产，不是债务。
5. 「文本 → 视频」这个目标**只能走前端这套**。不要试图让 worker 接受纯文本输入。

## 1. 结论：为什么现在跑不通

链路架构是健全的——数据模型、状态机、产物不可变性、队列领取、帧捕获、编码、拼接全是真的。
但链路上有 **3 个断点**，且**没有一个在画布 UI 侧**：

| 断点 | 位置 | 后果 |
| --- | --- | --- |
| Director pi 运行时被掏成 stub，无条件抛错 | `src/features/director/pi-session.ts:51-57`、`session-store.ts:40-44` | 六个阶段一个都执行不了 |
| `fabricateShot()` 定义了但全仓库零调用方 | `src/features/director/fabricate.ts:18` | 即使修好上一条，`shot-codegen` 仍在入队时因缺 `director-fabricate` 产物失败 |
| Next 应用进程内没有任何 AI 凭据 | 根 `.env.local` 只有 3 个 DB/密钥变量 | `getGeminiConfig()` 拿不到 key |

## 2. 为什么门禁全绿却跑不通（关键）

不是"测试写得松"，是**门禁被开了洞**，且洞的位置精确对应缺失的运行时：

- `vitest.config.ts:8-17` 显式 exclude 5 个测试文件，注释写着
  `Stage A explicitly removes these historical Pi, Trigger, and SQLite contracts.`
  其中 `pi-session.test.ts`（391 行）与 `session-store.test.ts`（81 行）**正是 pi 运行时的规格书**。
- `tsconfig.json:41-50` 又把其中 3 个文件从 typecheck 里 exclude 掉，
  因此 `session-store.test.ts:4` 那句 `import type { AgentMessage } from '@earendil-works/pi-agent-core'`
  引用一个**未安装的包**也不会让 `pnpm typecheck` 报错。

所以下面这组"绿"必须理解为**契约绿，不是运行时绿**：

```text
pnpm typecheck  -> exit 0
pnpm test       -> 98 files / 406 passed / 5 skipped, exit 0   （已 exclude 的 5 个文件根本没跑）
pnpm verify:v3  -> exit 1（仅 2 个 AGENTS.md 已登记的超行文件）
```

**恢复这两个门禁洞是 ISSUE-001 与 ISSUE-006 的强制交付物，不允许只补运行时而留着 exclude。**

## 3. 真实链路全图（文本 → MP4）

```text
用户输入 title + script(纯文本)
  createProject()                         features/canvas/actions.ts:28
    projects.script = 原始文本
    播种 4 个全局节点 + 2 条边
      script-import(INGEST) -> shot-split(DIRECT)     score(ASSEMBLE) -> export(FINALIZE)
    script-import.data.payload.directorInput = { rawScript: script }

POST /api/director/pipeline  ->  startProjectPipeline()  ->  autopilot=true  ->  入队 INGEST

[每个 director 节点的通用执行体]           features/director/stage-runner.ts:144
  loadStageContext -> transitionNodeStatus(running) -> buildStagePrompt
  -> createDirectorSession(...)            <== 断点 1（ISSUE-001）
  -> session.run({ prompt, tools, output })
  -> prepareStageResult                    归一化不可信模型输出
  -> writeValidatedArtifact                SHA-256 + 阶段门禁校验
  -> commitStageResult -> transitionNodeStatus(success) -> advancePipeline()

INGEST     -> scriptUnits[]（U001…）      并触发 materializeShotLanes 扇出
DIRECT     -> masterPlan + styleBible
  扇出：每个 script unit 生成一条 5 节点泳道
    shot-script(SHOT_SPEC) -> shot-codegen(FABRICATE) -> shot-sfx(ASSEMBLE)
                                                      -> shot-subtitle(ASSEMBLE) -> shot-qa(FINALIZE)
SHOT_SPEC  -> shotPlan JSON      输出取自 tool `validate_shot_plan` 的实参
FABRICATE  -> 确定性 HTML        输出取自 tool `check_determinism` 的实参
              必须自暴露 window.__CVC_RENDER__ = { version: 1, seek(frame, fps) }
  advance.ts:100 分流：shot-codegen 不进 director 队列，直接进 render 队列  <== 断点 2（ISSUE-002）
render-shot -> openFrameCapture(Chromium) 逐帧 seek + CDP captureScreenshot
               -> ffmpeg libx264 crf18 -> 单镜 MP4 artifact
shot-sfx      -> 真 TTS（StepFun）        features/director/stage-effects.ts 已接线
shot-subtitle -> 真 ASR
shot-qa       -> 规则 QA（Jimp 黑帧/纯色）+ 视觉 QA（LLM 看图核对 mustShow / mustAvoid）
export        -> exportProject() -> ffmpeg concat + 配乐 -> 终片 MP4 artifact
```

## 4. Issue 清单

状态口径：`open` 待处理；`in-progress` 进行中；`done` 已验收；`wontfix` 有意不做。

### P0 阻断「跑通」

| ID | 标题 | 状态 | 主要落点 |
| --- | --- | --- | --- |
| [ISSUE-001](./ISSUE-001-pi-agent-runtime.md) | Director pi-agent 运行时缺失，六阶段全部不可执行 | `done` | `src/features/director/pi-session.ts`、`session-store.ts`、`package.json`、`vitest.config.ts`、`tsconfig.json` |
| [ISSUE-002](./ISSUE-002-fabricate-render-seam.md) | FABRICATE→render 接缝断裂，`fabricateShot` 零调用方 | `open` | `src/features/render/queue-handler.ts`、`admission.ts`、`render-shot-repository.ts` |
| [ISSUE-003](./ISSUE-003-next-ai-credentials.md) | Next 应用进程内无 AI 凭据，配置真值不对称 | `done` | `.env.local`、`.env.example`、`docs/configuration/`、`scripts/setup/bootstrap-credentials.ts`、`tests/env.test.ts` |

### P1 能力与正确性

| ID | 标题 | 状态 | 主要落点 |
| --- | --- | --- | --- |
| [ISSUE-004](./ISSUE-004-queue-concurrency-lanes.md) | 队列单一并发数字混用 LLM 与渲染两类负载 | `done` | `src/lib/queue/in-process-queue.ts`、`types.ts`、`init.ts`、`index.ts`（commit `97b741e`） |
| [ISSUE-005](./ISSUE-005-audio-timing-truth.md) | `audio-demo` 编造固定 8 秒/镜时长，TTS 时序颠倒 | `done` | `audio-demo.ts`（已删）、`audio-timing.ts`、`stage-result.ts`、`src/features/audio/**`（commit `71f1de4` + `171f692`，证据 `evidence/issue-005/`） |

### P2 架构收敛与体验

| ID | 标题 | 状态 | 主要落点 |
| --- | --- | --- | --- |
| [ISSUE-006](./ISSUE-006-dormant-pipeline-layer.md) | `src/features/pipeline/**` 整层休眠，是第三套执行模型 | `open` | `src/features/pipeline/**`、`vitest.config.ts`、`tsconfig.json` |
| [ISSUE-007](./ISSUE-007-duplicate-canvas.md) | 两套画布实现并存（`WorkflowCanvas` vs `CanvasView`） | `done` | `src/features/workflow/**`、`src/app/playbook/registry.ts` |
| [ISSUE-008](./ISSUE-008-canvas-layout-truth.md) | dagre 每次重算布局，覆盖已持久化坐标 | `open` | `src/features/canvas/layout.ts`、`canvas/[projectId]/page.tsx` |
| [ISSUE-009](./ISSUE-009-routing-convergence.md) | routing.md §11 收敛清单未清（编码、robots、sitemap、token） | `done` | `canvas-inspector.tsx`、`robots.ts`、`sitemap.ts`、`empty-state.tsx`、`button.tsx`（commit `94af7d3`，证据 `evidence/issue-009/`） |
| [ISSUE-010](./ISSUE-010-oversized-files.md) | 2 个超硬上限文件使 `verify:v3` 恒红 | `done` | `export-workspace.tsx`、`shot-detail.tsx` |
| [ISSUE-011](./ISSUE-011-settings-placeholders.md) | 设置页占位项与只读并发数 | `open` | `settings-form.tsx` |
| [ISSUE-012](./ISSUE-012-canvas-live-updates.md) | 画布靠 1.5s `router.refresh()` 轮询驱动状态 | `open` | `canvas-view.tsx`、`src/lib/stream/**` |
| [ISSUE-013](./ISSUE-013-ai-adapter-boundary.md) | `features/ai` 适配器与 pi-ai 会形成第二套 provider 客户端 | `in-progress` | `src/features/ai/**`、`src/features/render/vision-qa.ts` |

### 贯穿

| ID | 标题 | 状态 | 主要落点 |
| --- | --- | --- | --- |
| [ISSUE-014](./ISSUE-014-e2e-verification.md) | 端到端验证与证据留存（先小后大） | `open` | `scripts/verify/`、`docs/issues/evidence/` |

## 5. 依赖与派发顺序

```text
第一批（可完全并行，文件零重叠）—— 已全部落地
  ISSUE-001  done · commit 847722d + 4b621fe · 真实 INGEST 运行取证
  ISSUE-003  done · 7 commits · bootstrap 凭据写入 DB 加密存储
  ISSUE-004  done · commit 97b741e · 队列分轨 + 队头阻塞回归测试
  ISSUE-007  done · commit cfcc52a · 删除 WorkflowCanvas
  ISSUE-009  done · commit 94af7d3 · routing §11 收敛清单全清
  ISSUE-010  done · 5 commits · verify:v3 转绿，前后截图 SHA-256 一致
  ISSUE-013  in-progress · 分析完成，实施收尾中（释放 openai 债务空间）

第二批（ISSUE-001 已落地，可开工）
  ISSUE-002  fabricateShot 入 render 队列
  ISSUE-006  接手 vitest/tsconfig 第 14-16 行 / 第 49 行所有权

第三批（依赖前两批）
  ISSUE-005  done · 71f1de4 + 171f692 · 真实 TTS 前移到 INGEST，时长实测取证
             （单镜 MP4 时长对比仍待 ISSUE-002 打通渲染接缝后补，已在文件内登记）
  ISSUE-011  需要 004 才有真实可配的并发数（004 已 done，可提前）
  ISSUE-008  ISSUE-012  独立收尾

全程
  ISSUE-014  每批结束跑一次对应规模的端测并留证
```

## 6. 唯一的共享文件争用

`vitest.config.ts` 与 `tsconfig.json` 的 exclude 列表被两个 issue 同时涉及。
**必须按行分配所有权，禁止两人同时改：**

| 文件 | 行 | 内容 | 所有者 |
| --- | --- | --- | --- |
| `vitest.config.ts` | 12 | `src/features/director/pi-session.test.ts` | ISSUE-001 |
| `vitest.config.ts` | 13 | `src/features/director/session-store.test.ts` | ISSUE-001 |
| `vitest.config.ts` | 14 | `src/features/pipeline/contracts/contracts.test.ts` | ISSUE-006 |
| `vitest.config.ts` | 15 | `src/features/pipeline/contracts/task-source-boundary.test.ts` | ISSUE-006 |
| `vitest.config.ts` | 16 | `src/lib/db/runtime-boundary.test.ts` | ISSUE-006 |
| `tsconfig.json` | 47 | `src/features/director/pi-session.test.ts` | ISSUE-001 |
| `tsconfig.json` | 48 | `src/features/director/session-store.test.ts` | ISSUE-001 |
| `tsconfig.json` | 49 | `src/features/pipeline/contracts/contracts.test.ts` | ISSUE-006 |

ISSUE-001 先于 ISSUE-006 落地，可避免两次 rebase。

## 7. 环境实测基线（2026-07-25）

修复者应先复现这组数字，确认起点一致。

| 项 | 实测结果 |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 98 files / 406 passed / 5 skipped，exit 0 |
| `pnpm verify:v3` | exit 1，2 条 `OVERSIZED_NEW_FILE` |
| Postgres | `purpleink-dev-postgres-1` healthy，`127.0.0.1:54328` |
| Playwright Chromium | 已安装（`%LOCALAPPDATA%\ms-playwright`，含 chromium-1234） |
| ffmpeg | `node_modules/ffmpeg-static/ffmpeg.exe` 存在 |
| 根 `.env.local` 变量 | `DATABASE_URL`、`CVC_CREDENTIAL_MASTER_KEY`、`TEST_DATABASE_URL`（无任何 AI key） |
| `server/.env` 变量 | 含 `GEMINI_API_KEY`、`STEP_API_KEY`、`LISTENHUB_API_KEY` 等 22 项，全部非空 |

### Gemini 真实 API 探测（同日，使用 `server/.env` 中的 key）

| 探测项 | 结果 |
| --- | --- |
| `GET /v1beta/models` | 200，56 个可用模型 |
| `gemini-3.6-flash`（`GEMINI_PRIMARY_MODEL`） | 存在 |
| `gemini-3.1-flash-lite`（`GEMINI_FAST_MODEL`） | 存在 |
| OpenAI 兼容端点 function calling | 成功返回 `validate_shot_plan` 工具调用，延迟 2312ms |
| SSE 流式（`/v1beta/openai/chat/completions`） | 200，`text/event-stream` |
| SSE 流式（`/v1beta/models/*:streamGenerateContent?alt=sse`） | 200，`text/event-stream` |
| **并发 16 路** | **16/16 成功，墙钟 1482ms，零限流** |

结论：并发 >10 无外部障碍。「并发速率快」的真实瓶颈在队列设计（ISSUE-004），不在 provider 限流。

## 8. 已确认无需处理的事项

写在这里，避免修复者重复发现或"顺手优化"。

| 事项 | 结论 |
| --- | --- |
| 配置热更新 | **已经是热的**。`getGeminiConfig()` / `getStepfunConfig()` / `resolveDirectorModelTarget()` 每次调用都重读 DB + `process.env`，无 import 期快照。优先级 `DB 路由 > env > 代码默认值`。 |
| 是否引入 YAML 配置 | **不引入**。会成为第四套真值，违反 AGENTS.md 单一真值原则。真正缺的是凭据写入面（ISSUE-003），不是配置格式。 |
| `src/features/render` 与 `server/src/compose` 重复 | **不是重复**，是两个不同产品（见 §0）。 |
| `stream-bus` 仅进程内、不跨进程 | 单进程 Demo 已够用，已在代码注释登记；多实例部署再换 Redis pub/sub。 |
| worker 额外回传 `createdAt/updatedAt` | 已在 `docs/reviews/qoder-architecture-cleanup-2026-07-25.md` F-06 登记为 `不修`。 |
| Artifact 不可变性 / `content_hash` / 凭据加密 | 已审查通过（同上文档 P3 节）：DB 触发器拦截 approved/released 的 UPDATE/DELETE；hash 取实际字节 SHA-256；AES-256-GCM + AAD 绑定 workspace，无明文 fallback。 |
| 营销页 3 个超行文件 | 已在 `verify:v3` baseline 登记且禁止增长，不在本目录范围。 |

## 9. `verify:v3` 架构红线（所有 issue 都受约束）

来自 `scripts/verify/v3-architecture.ts`，修复时务必遵守：

1. `@openai/agents*` **零容忍**，出现在 `package.json`、`pnpm-lock.yaml` 或任何 import 即失败。
2. `import ... from 'openai'` 的**债务上限固定为 3**，当前刚好用满：
   `features/ai/gemini-adapter.ts:2`、`features/ai/stepfun-adapter.ts:2`、`features/render/vision-qa.ts:3`。
   **新代码不得再直接 import `openai`**（这正是 ISSUE-013 存在的原因）。
3. `src/features/canvas/**` 禁止 import `@earendil-works/pi-*`、`hyperframes`、`drizzle-orm`、`trigger` 相关。
   画布层必须保持纯净——门禁已经在替 pi-agent 站岗，说明 pi-agent 是本项目预设框架，方向无需改。
4. 全仓库禁止 U+FFFD replacement character。
5. 生产文件硬上限：`page.tsx` 300、一般文件 350、schema/repository 400；超限文件只允许持平或下降。
