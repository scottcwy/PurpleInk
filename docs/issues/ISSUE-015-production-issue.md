# ISSUE-015 · Docker 生产部署前置问题与分批修复清单

- 优先级：**P0（阻断上线）**
- 状态：`in-progress`（P-1/P-2/P-3/P-6/P-7 已完成，见 §9）
- 范围：`next.config.ts`、`.dockerignore`、`Dockerfile`、生产 compose、
  `src/lib/queue/**`、`src/features/render/{encode,concat}.ts`、
  `src/app/api/settings/route.ts`、`scripts/verify/`、`docs/deployment/`
- 依赖：ISSUE-014 第一轮已通过（链路本身可跑通）
- 性质：部署面缺失 + 若干运行时假设在容器内不成立
- 撰写日期：2026-07-26
- 审查基线：`c68a72e`（ISSUE-014 第一轮取证入档后）

## 0. 结论

「文本 → 成片」链路本身已经端到端跑通（ISSUE-014 §9）。**部署面已落盘**
（P-6/P-7，见 §9）：`Dockerfile`、`server/Dockerfile`、
`docker-compose.prod.yml`、反代（`deploy/reverse-proxy/`）均已构建并实测通过；
入站边界已由部署层收敛（P-2）。**成片音轨与硬字幕阻塞项（P-3）已核销**。
除此之外还有一类问题：

1. **已核销的上线阻塞项**——P-3 已选择旁白混音方案，并同时交付硬字幕；
   零认证已由 P-2 在部署层收敛为"受信网络 + Basic Auth"，应用内认证仍是独立议题
   （见 §2.1「当前处置」与 `PLAN-002-auth-system.md`）。
2. **一批在开发机成立、在容器里不成立的运行时假设**——CPU 核数（P-4，`todo`）、
   Chromium 沙箱与 CJK 字体（P-6，`done`）、生产构建的日志剥离（P-1，`done`）、
   渲染缓存的字体无关性（P-7 运行手册已提示，见 `docs/deployment/runbook.md` §6）。

本文件按「会不会挡住上线」排序记录证据，并在 §9 给出可逐项派发的分批修复清单。

## 1. 现状基线（2026-07-26 实测）

| 项 | 实测结果 |
| --- | --- |
| `Dockerfile` / 生产 compose | **已落盘**：根 `Dockerfile`（Next，四阶段）、`server/Dockerfile`（worker，两阶段）、`docker-compose.prod.yml`（commit `6e34a01` / `ca8f19d`） |
| `.dockerignore` | 原本不存在，已由 P-1 补上 |
| `docker-compose.dev.yml` | 仅 1 个 `postgres:17.5-alpine`，口令 `cvc_dev_only`，端口只绑 `127.0.0.1:54328`（生产 compose 不继承） |
| `output: 'standalone'` | 未启用（P-6 §2.4 首版推荐路径：整份 `node_modules` 进运行镜像，体积大但零风险） |
| `engines` 字段 | 已补 `"node": ">=22.11.0"`（commit `6e34a01`），容器实测 `node -v` = `v22.23.1` |
| `packageManager` | `pnpm@10.30.0` |
| 认证守卫 | **分层表述**：入站边界已由部署层保证（反代 IP 过滤 + Basic Auth over TLS，commit `f5a7ab3`）；应用内认证仍未落地，详见 §2.1「当前处置」与 `PLAN-002-auth-system.md` |
| `final-mp4` 音轨 | `cvc.final-video/v2` 含 H.264 视频、AAC 旁白与烧录硬字幕；旧 `v1` 静音成片保持不可变（详见 §2.2） |
| 队列位置 | 不变，仍在 Next 进程内（`src/instrumentation.ts` → `initQueue()`） |

## 2. 阻塞项

### 2.1 零认证，不得暴露公网

**当前处置（P-2，commit `f5a7ab3`）**：入站已由部署层拒绝未授权请求——反代
（`deploy/reverse-proxy/Caddyfile`）在网络层 IP 过滤 + Basic Auth over TLS
两道防线上默认拒绝（不做路径白名单），`next` / `postgres` / `worker` 容器均
不 publish 端口，反代是唯一暴露面。证据见 `docs/issues/evidence/issue-015/p2/`。

**明确写清残留风险**：P-2 只是把「公网任意人」收敛成「受信网络内 + 拿到共享
口令的任意人」——**不等于应用内认证已实现**。拿到凭据的任何人仍是全权管理员
（无租户、无角色、无审计）；产物 URL 仍携带内部 `projectId`；
`LOCAL_WORKSPACE_ID` 仍是硬编码单工作区。下面的问题描述保留作为历史证据，
应用内认证是独立议题，见 `PLAN-002-auth-system.md`。

---

`docs/conventions/routing.md` §9.1 原文已写明：守卫是目标状态、不是已实现状态，
**认证落地前只能跑在本地或受信网络内，不得直接暴露公网**。

实测确认其严重程度：

- `next-auth` / `getServerSession` / `requireAuth` / 401 守卫在 `src/**` 零命中；
- 没有 `proxy.ts`，也没有 `middleware.ts`；
- `/login`、`/signup` 是 `AuthShellForm` 的禁用态占位（routing.md 标 `shell`）；
- `LOCAL_WORKSPACE_ID` 是硬编码常量（`src/lib/db/client.ts:11`），单工作区、无租户隔离。

无凭据即可调用的暴露面：

| 端点 | 后果 |
| --- | --- |
| `POST /api/settings` | 写 provider 凭据与并发配额 |
| `POST /api/director/pipeline` | 无限触发真实 Gemini + StepFun 调用，直接消耗 API 额度 |
| `POST /api/render` / `POST /api/render/export` | 触发 Chromium 渲染与 ffmpeg 拼接，消耗 CPU |
| `GET /api/artifacts/{id}?projectId=` | 下载任意产物字节 |

因此**第一步不是写 Dockerfile**，而是先定接入策略。真正的应用内认证是独立议题，
不要在部署批次里顺手做（会同时牵动 routing.md §9 的守卫矩阵与工作区模型）。

### 2.2 成片音轨与硬字幕（已修复）

修复前实测 `final-mp4` 的流信息只有 `0,h264,video`，原因不是偶发：

- 单镜编码只生产无声 `render-mp4`；
- 旧导出只拼接视频，旁白 `narration-audio:U00N` 从不参与最终装配；
- 字幕 Artifact 已存在，但没有进入视频烧录。

ISSUE-005 的交接文档已把它登记为遗留观察（当时判断混音属 ASSEMBLE / 导出范围）。
P-3 已通过“最终导出阶段统一媒体装配”修复：导出前按 lane/unit/hash 校验
`render-mp4`、旁白和字幕 Artifact，按 `audioAllocation` 裁剪旁白并生成全局 ASS，
再由一次 ffmpeg 输出 H.264 + AAC + 硬字幕的 `cvc.final-video/v2`。任一必需媒体
缺失或不可信时 fail-closed；没有改写已实测的 `durationInFrames`。实测证据见
`docs/issues/evidence/issue-015/p3/README.md`。

## 3. 架构与运行时约束

### 3.1 只能单实例；重启会留下孤儿作业

两件事要分开看：

**领取本身是多实例安全的**——`InProcessQueue.claim()` 用
`FOR UPDATE SKIP LOCKED`，多副本不会重复消费同一个 attempt。

**但多实例仍不可行**：`stream-bus` 与 `status-bus` 都是进程内 + `globalThis`
锚定（`docs/issues/README.md` §8 已登记）。A 实例执行作业、B 实例持有 SSE 连接时，
画布状态推送与 Director 文本流会静默丢事件，只能退回 1.5s 轮询兜底。

**没有 lease / heartbeat / reclaim**——`src/lib/queue/**` 内
`stale|reclaim|heartbeat|lease|requeue` 零命中，`claim()` 只挑 `queued`。
进程被 kill（滚动更新、OOMKilled、节点漂移）时，`task_attempts.status='running'`
与 `canvas_nodes.status='running'` 会**永久卡住**，无任何机制捞回。

实践含义：`replicas: 1`；用 recreate 而非滚动更新；容器需要足够长的
`stop_grace_period`；更新前最好先关 autopilot 并等队列排空。

### 3.2 容器内 CPU 核数被读错，会导致 OOMKilled

`defaultRenderShotConcurrency()` = `max(1, floor(os.cpus().length / 2))`。
Node 的 `os.cpus()` 读**宿主核数**，不读 cgroup 限制。一个 render 作业
= 一个 Chromium + 一个 ffmpeg，都是 CPU 与内存大户。

宿主 32 核、容器限 2 核时，它会开 16 路并行渲染。

同一问题也出现在校验面：`src/app/api/settings/route.ts` 对 `renderShot` 的动态
上限校验同样用 `os.cpus().length`，所以设置页会允许保存远超容器实际能力的值。

另注意 ISSUE-011 的既有语义：DB 配额改动**要重启进程才生效**，这是有意设计、
UI 也如实标注了，不要在部署时误判为「配置没生效」。

### 3.3 Chromium 在 Docker 的三个硬点

`src/features/render/frame-capture.ts:23` 是 `chromium.launch({ headless: true })`，
没有任何 args。

1. **以 root 运行会直接失败**（Chromium 拒绝 root 且无 `--no-sandbox`）。
   优先用非 root 用户（Playwright 官方镜像的 `pwuser`）而不是加 `--no-sandbox`
   ——这个进程要加载模型生成的 HTML，沙箱是有意义的防线。
2. **系统依赖与版本对齐**：`playwright@^1.61.1`，镜像里的浏览器版本必须与之匹配，
   否则 launch 时报浏览器缺失。
3. **CJK 字体（最容易漏）**：本产品所有屏幕文字都是中文。精简镜像缺 CJK 字体时，
   每一帧都会渲成豆腐块，而 `shot-qa` 的视觉 QA 会拿这些帧去核对 `mustShow`
   ——得到的是「渲染成功但内容全错」的假绿。必须显式安装 CJK 字体。

### 3.4 字体差异会让渲染缓存错误命中

渲染与缩略图缓存的 key 由 HTML 字节 + frames 规格派生
（`thumbnailSourceKey` 与 renderer 的 renderHash 同源语义），**不包含字体环境**。

所以把开发机的 `.data` 卷带到生产复用时，用 Windows 字体渲出的 MP4 会被判定命中
直接复用，生产永远渲不出 Linux 字体下的正确画面。

结论：生产用全新 artifacts 目录；确需迁移历史数据时，明确排除
`render-mp4` / `frame-thumbnail` / `director-fabricate` 这几类可重算产物。

### 3.5 生产构建曾吞掉全部服务端诊断日志（P-1 已修）

`compiler.removeConsole` 原本传布尔 `true`，SWC 会移除**全部** `console.*`
（含 `console.error`）。而这些 `console.error` 是有意设计的唯一诊断出口——服务端
刻意不把 provider 原始错误暴露给用户（AGENTS.md §6），只在日志留分类信息。

实测对比（生产构建 server chunk 内字符串命中数）：

| 日志 | 修复前 | 修复后 |
| --- | ---: | ---: |
| `[director] 模型调用失败` | 0 | 4 |
| `[render] 下游自动推进失败` | 0 | 7 |
| `[render/export] QA 检测触发失败` | 0 | 1 |
| `[instrumentation] 队列启动失败` | 0 | 1 |

已改为 `{ exclude: ['error', 'warn'] }`（commit `2c7d4d4`）。
`src/**` 内没有任何 `console.log`，因此 log 剥离对应用代码本就是空操作。

## 4. 镜像与构建

- **`ffmpeg-static` 靠 postinstall 下载平台二进制**。必须在 Linux 镜像内执行
  `pnpm install`，绝不能从 Windows 宿主 `COPY node_modules`。（P-1 的 `.dockerignore`
  已把 `node_modules` 排除在构建上下文之外，从机制上避免误拷。）
- **未启用 `output: 'standalone'`**。要么整份 `node_modules` 进运行镜像，要么启用
  standalone 后**实测验证** `serverExternalPackages` 里那三个包
  （`ffmpeg-static`、`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`）
  被正确带出。这三个是外部化的，standalone 的自动依赖追踪容易漏——pi-ai 那条正是
  ISSUE-012 踩过的 `MODULE_NOT_FOUND`（commit `5be5869`）。
- **迁移与 bootstrap 脚本走 `tsx`，那是 devDependency**。运行镜像若只装 prod 依赖，
  `pnpm db:migrate` 与 `scripts/setup/bootstrap-credentials.ts` 会缺依赖。
- **没有 `engines` 字段**。Next 16 需要 Node 20.9+ / 22，基础镜像版本要自己钉死。
- **`ffprobe` 不在依赖里**。运行时代码不用它（`src/**` 零命中），但任何「验证成片」
  的运维脚本需要它。ISSUE-014 第一轮用的是宿主 winget 安装的 `Gyan.FFmpeg`，
  仓库不自带，已在该 issue 证据里如实记录。

## 5. 数据与密钥

- **`DATA_DIR` 是所有媒体字节的唯一副本**（默认 `<cwd>/.data`，
  `ARTIFACTS_DIR` = 其下 `artifacts`，见 `src/lib/config/paths.ts`）。必须是持久卷。
  卷丢失后 DB 行仍在、字节全无，得到一批能查到 `content_hash` 却下载不了的悬空产物；
  而 approved / released 产物有 DB 触发器保护不可原地更新，修复只能靠新版本。
- **`CVC_CREDENTIAL_MASTER_KEY` 丢失 = 所有 provider 凭据不可解密**，设计上无明文
  fallback（AGENTS.md §7 + 两条契约测试锁定）。轮换至今是手工操作。该 key 必须走
  secret 管理，不得进镜像层。
- **凭据注入优先走设置页 / `POST /api/settings`**（有真实 API 校验、失败 422 且不
  覆盖已有值），而不是把 `.env.local` 打进镜像。`bootstrap-credentials.ts` 在设计上
  是读 `.env.local` 的冷启动脚本。应用没有凭据也能正常启动（凭据只在跑管线时才需要），
  所以「先起服务 → 设置页写入」是可行且更干净的顺序。

## 6. Postgres

- 客户端是 `postgres.js`，`postgres(databaseUrl)` **未传任何连接参数**，走默认连接数
  与 `prepare: true`。若前面挂 PgBouncer 的 transaction 模式，必须关 `prepare`。
- 队列每 200ms tick 一次、按 lane 数并行查询，长期空转也有稳定基础负载。连接数要给
  SSE 长连接与页面留余量。
- **迁移必须在应用启动前完成，并连续跑两次验证幂等**。`_journal.json` 时间戳乱序曾让
  `0003` 被 drizzle 判定过期而跳过，造成 schema 与 DB 不一致、全库建项目 400
  （ISSUE-008 / ISSUE-012 均有记录）。容器化后这个风险更隐蔽。
- dev compose 的口令是 `cvc_dev_only`，生产必须更换；生产 compose 不要映射 5432。

## 7. worker（`server/`）是否需要部署

`/api/engine` 只被 `src/lib/api.ts` 的 `API_BASE` 使用，而它只被**一个文件**引用：
`src/components/marketing/launch-composer.tsx`。

也就是说制作应用 `/products/*` 完全不依赖 worker。可以先只部署 **Next + Postgres**，
核心「文本 → 成片」链路完整可用；代价是营销首页的 Try 演示会 502。

若要一起部署 worker，注意它是另一套系统：独立 env 模板（`server/.env.example`，
含 ListenHub / IMAP）、独立 job 状态机、需要 `sharp` 与自己的 Playwright。
AGENTS.md §0 / `docs/issues/README.md` §0 明确禁止合并两套的 env 加载器、
model routing 与 job 状态机——不要在 Dockerfile 里图省事共用一份配置。

## 8. 已确认无需处理

写在这里避免重复发现或「顺手优化」。

| 事项 | 结论 |
| --- | --- |
| SSE 被反代缓冲 | **已做对**。两个流式路由都设了 `Cache-Control: no-cache, no-transform` 与 `X-Accel-Buffering: no`。只需保证 LB 的 idle timeout 大于 15s keepalive 间隔。 |
| 导出长任务占用 HTTP 请求 | 不存在。等待发生在队列内（`runProjectExport` 上限 1800 × 1s），HTTP 只返回 jobId。 |
| 构建期需要 DB | 不需要。`instrumentation.register()` 有 `NEXT_PHASE === 'phase-production-build'` 守卫，静态预渲染页面也不查库。建议在流水线里实测一次确认。 |
| 客户端轮询无上限 | `renderShotAndWait` / `waitForExportArtifact` 是无界 `for(;;)`。页面长时间停留会持续轮询，不阻塞部署，仅需知道。 |

## 9. 分批修复清单

按依赖顺序排列。每项都可独立派发、独立验收。
状态口径：`done` 已完成；`todo` 待处理；`blocked` 等前置；`decision` 需产品决策。

---

### P-1 · 生产构建保留 error/warn + 补 `.dockerignore` —— `done`

- **落点**：`next.config.ts`、`.dockerignore`（新增）
- **commit**：`2c7d4d4`
- **验收**（已核销）：
  - 生产构建的 server chunk 内四条应用日志字符串命中数由 0 变为 4 / 7 / 1 / 1；
  - `pnpm build` exit 0（隔离 distDir 全新构建）；
  - lint / typecheck exit 0；`pnpm test` 112 files / 543 passed；`verify:v3` ok:true。

---

### P-2 · 定接入策略并落地边界防护 —— `done`

**这是所有后续步骤的硬前提**（§2.1）。

**决策结论**：网络层 IP 过滤（默认放行，生产收紧）+ 反代 Basic Auth over TLS
（Caddy）。理由：客户端画布状态订阅用同源 `EventSource`
（`use-project-status-stream.ts`、`use-stage-stream.ts`），**它不能设置自定义
请求头**——任何要求 `Authorization: Bearer <token>` 的方案都会打断 SSE，因此
排除 header token 与需要签发端的 Cookie 会话方案（后者等于在部署层做半个
认证系统，违反本项禁区）。Basic Auth 走浏览器原生凭据缓存，同源请求（含
`EventSource`）自动带上，对前端代码零侵入。反代选 Caddy：内置自动 TLS，
`basic_auth` 与 `remote_ip` 匹配器能力足够。详见 `docs/deployment/access.md`。

- **commit**：`f5a7ab3`
- **落点**：部署层（`deploy/reverse-proxy/`、`docker-compose.prod.yml`），
  **未改 `src/**`**（`docs/conventions/routing.md` §9.1 追加一段除外，属文档）。
- **做法要点**（均已落地）：
  - Next 容器不写 `ports:`，只对反代暴露；
  - Postgres 不映射宿主端口；
  - 反代放行 SSE：`flush_interval -1`，不启用 gzip/encode。
- **验收**（已核销，证据见 `docs/issues/evidence/issue-015/p2/`）：
  - 未携带凭据时 `POST /api/settings`、`POST /api/director/pipeline`、
    `GET /api/artifacts/{id}?projectId=`、`GET /api/ping` 四条实测均返回
    401（`Www-Authenticate: Basic realm="restricted"`），反代 access log 有
    完整记录，同一时间窗内 `next` 容器日志对这三个关键字零命中；
  - 携带凭据后 `GET /api/director/stream/project/{projectId}` 立即收到
    `snapshot` 事件，空闲超过 15s 后仍收到 `: keepalive`（证明未被缓冲、
    未被提前断流）；
  - 宿主对 Postgres 端口的连接测得 `TcpTestSucceeded: False`。
- **禁区**：不要在本项里实现应用内认证。那会牵动 routing.md §9 守卫矩阵与
  `LOCAL_WORKSPACE_ID` 单工作区模型，必须单开 issue（见 `PLAN-002-auth-system.md`）。

---

### P-3 · 成片旁白与硬字幕闭环 —— `done`

已选择方案 A，并把字幕作为同一确定性媒体装配阶段的硬字幕交付：

- **已完成**：导出层把
  `narration-audio:U00N` 按 allocation 的 `startInUnitMs` / `endInUnitMs` 混入。
  字幕用原稿文本和可信时间锚点生成 ASS 后烧录；旧 `v1` 静音成片不覆盖。
- **验收**：完整历史项目 7/7 旁白与 7/7 字幕复用成功，两次导出 SHA-256 一致；
  极小真实 E2E 的全部节点成功，`ffprobe` 显示 H.264 + AAC，音画时差小于一帧，
  中点抽帧的中文硬字幕清晰。详见 `evidence/issue-015/p3/README.md`。
- **提交**：`c2fc524`、`2f47aae`、`583d0e3`、`bbbe91e`。
- **禁区保持**：没有为了让音轨对齐而调整已实测的 `durationInFrames`。

---

### P-4 · 并发配额在容器内可信 —— `todo`

见 §3.2。

- **落点**：`src/lib/queue/in-process-queue.ts`（默认值来源）、
  `src/app/api/settings/route.ts`（动态上限校验）
- **做法（建议）**：引入一个「可用 CPU 数」的单一读取口，优先读
  cgroup v2 的 `cpu.max`（`/sys/fs/cgroup/cpu.max`），退回 `os.cpus().length`；
  默认配额与设置页上限都改用它。**不要在两处各写一份探测逻辑**——
  ISSUE-004 已导出 `isPositiveInteger()` 的先例，同一规则只能有一个出口。
- **验收**：
  - 单测覆盖「cgroup 限额存在时取限额」「无限额时退回宿主核数」「格式非法时退回」；
  - 在 `--cpus=2` 的容器里实测默认 `renderShot` 配额为 1，且设置页不允许保存 > 2；
  - 现有 `resolveLaneQuotas` / `loadLaneQuotasForStart` 的 DB > env > 默认优先级不变
    （ISSUE-011 的单真值原则）。
- **兜底**：本项落地前，生产必须显式设置
  `CVC_QUEUE_RENDER_SHOT_CONCURRENCY` 与 `CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY`。

---

### P-5 · 队列重启后可回收孤儿作业 —— `todo`

见 §3.1。当前进程被 kill 会永久留下 `running` 的 attempt 与节点。

- **落点**：`src/lib/queue/in-process-queue.ts` + `init.ts`
- **做法（两个层次，建议只做第一层）**：
  1. **启动期回收**：`initQueue()` 时把本 workspace 内仍为 `running` 的 attempt
     标记为 `failed`（附明确 failure message，如「进程重启前中断」），并把对应节点
     经合法转换落到 `failed`。单实例前提下这是安全且足够的。
  2. （可选、需先做多实例改造）真正的 lease + heartbeat 续租。
- **验收**：
  - pg 测试：种入一个 `running` attempt + `running` 节点，跑 `initQueue()` 后两者
    都成为 `failed` 且 failure message 可归因；
  - 节点状态转换必须走 `transitionNodeStatus` 的合法路径，不得直接 UPDATE 绕过状态机；
  - 不影响 ISSUE-006 的「无 HTTP 请求也消费队列」语义与 `init.test.ts` 既有用例。
- **禁区**：不要顺手把 `running` 直接改回 `queued` 自动重试——渲染与 LLM 阶段都可能
  已产生部分副作用，静默重试会掩盖真实失败。

---

### P-6 · 写 Dockerfile —— `done`

**基础镜像选型结论**：计划草稿推荐的选项 A（`mcr.microsoft.com/playwright:v1.62.0-noble` /
`:v1.62.0`）实测 `docker pull` 均 `not found`（两个 tag 都试过）。改走选项 B：
`node:22-bookworm-slim` + `playwright install-deps chromium` + 非 root `playwright
install chromium`（浏览器版本按 `node_modules` 实际安装版本对齐，不硬编码
`package.json` 声明的 `^1.61.1`）。CJK 字体从 `fonts-noto-cjk` 改为 `fonts-wqy-zenhei`
（前者 60.2MB 单文件在本仓库构建网络环境下反复下载失败，后者 7.5MB 稳定成功且同样覆盖中文字形）。

- **commit**：`6e34a01`
- **镜像**：`purpleink-dev-next`（5.29GB）、`purpleink-dev-worker`（5.13GB）、
  `purpleink-dev-reverse-proxy`（82.9MB）
- **`node -v` 实测**：`v22.23.1`（两个镜像一致，满足新补 `engines.node >=22.11.0`）
- **`output: 'standalone'` 取舍结论**：未启用，首版采用 §2.4 推荐路径（整份
  `node_modules` 进运行镜像，体积大但零风险）
- **做法要点**（均已落地）：
  - **显式安装 CJK 字体**（`fonts-wqy-zenhei`）；
  - **以非 root 用户运行**（`pwuser`，uid 999），不加 `--no-sandbox`；
  - 镜像内 `pnpm install --frozen-lockfile`，未拷宿主 `node_modules`；
  - Node 版本钉死（`node:22-bookworm-slim`），`package.json` 已补 `engines`；
  - 未启用 `output: 'standalone'`，无需验证 `serverExternalPackages` 带出；
  - 迁移单独一个 `migrate` stage（保留 devDependencies 含 `tsx`）。
- **构建期连带发现并修复的两个真实 bug**（非 P-6 计划内条目，详见
  `docs/issues/evidence/issue-015/p6/README.md` §7）：根 `package.json` 缺
  `@next/env` 直接依赖声明（已用 `pnpm add -w` 补上）；`node_modules/.bin/{next,tsx}`
  是 pnpm 生成的 POSIX shell shim，`node <shim>` 会报语法错误（两个 Dockerfile 的
  `CMD` 已改为直接调用入口）。
- **验收**（已核销，证据见 `docs/issues/evidence/issue-015/p6/`）：
  - 容器内 `chromium.launch()` 成功（`id` 输出 `uid=999(pwuser)`，无 `--no-sandbox`）；
  - 容器内渲一帧，抽帧目视确认中文不是豆腐块（存图 `p6/cjk-frame.png`）；
  - `ffmpeg-static` 二进制存在且可执行（`ffmpeg version 7.0.2-static` 有输出）；
  - `node -v` = `v22.23.1`，与 `engines.node` 一致。

---

### P-7 · 生产 compose 与运行时配置 —— `done`

- **commit**：`ca8f19d`
- **是否部署 worker**：**一起部署**。`docker-compose.prod.yml` 含 `worker` 服务，
  不 publish 端口，`next` 经 `BACKEND_ORIGIN=http://worker:8787` 内网访问；
  独立 env、独立健康检查，不与 `next` 共用配置（AGENTS.md §0 硬边界）。
- **两个并发配额 env 实际取值**：`docker-compose.prod.yml` 用 `${VAR:?错误提示}`
  语法强制要求显式设置 `CVC_QUEUE_RENDER_SHOT_CONCURRENCY` 与
  `CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY`，缺失时 compose 直接拒绝启动；本地
  验证值为 `1`，生产按 `docs/deployment/runbook.md` §3 根据容器 `--cpus` 上限设置。
- **迁移两次的输出路径**：`docs/issues/evidence/issue-015/p7/README.md` §1
  （完整命令行与输出）。
- **做法要点**（均已落地）：
  - `replicas: 1`（§3.1），recreate 而非滚动更新，`stop_grace_period: 120s`；
  - `DATA_DIR` 指向 `cvc_data` 持久卷（全新卷，不复用开发机的，§3.4）；
  - Postgres 用 `${POSTGRES_PASSWORD:?}` 强制要求强口令、不映射任何宿主端口、独立持久卷；
  - `CVC_CREDENTIAL_MASTER_KEY` 运行期从宿主 `.env`（已 gitignore）注入，不进镜像层与 compose 明文；
  - 迁移用单独 `migrate` 服务（一次性任务，`depends_on: postgres healthy`）执行，
    **连续跑两次**均成功且第二次无变更；
  - `docs/deployment/runbook.md` 已写明非正常重启后 `running` 记录需人工核对
    （P-5 未落地的提醒）、卷备份建议、凭据轮换步骤。
- **验收**（已核销，证据见 `docs/issues/evidence/issue-015/p7/`）：
  - `pnpm db:migrate`（`docker compose run --rm migrate`）连续两次均成功，
    第二次只有幂等 NOTICE，无实际 DDL 变更；
  - 容器重启（`down` + `up`）后新建项目仍可通过 `GET /api/projects` 查到，
    DB 数据完整；
  - `docker compose config` 在未设真实值环境下全文搜不到明文 secret
    （`secrets:` 顶层只暴露文件路径）。

---

### P-8 · 生产环境端到端验收 —— `todo`（前置 P-7 已满足）

- **落点**：`scripts/verify/e2e-smoke.ts`（已存在，复用；已支持
  `CVC_VERIFY_BASIC_AUTH` 反代凭据注入）、`docs/issues/evidence/issue-015/`
- **做法**：起服务 → 设置页写入凭据（真实 API 校验）→
  `pnpm verify:e2e --base-url <生产地址>`。
- **验收**：
  - 全部节点 `succeeded`，不可变产物哈希逐条一致；
  - `ffprobe` 核对成片帧数 = 各镜帧数之和；分辨率 / fps 与 `renderSpec` 一致；
  - 成片沿用 P-3 的 v2 合同，必须含 AAC 旁白与可见的中文硬字幕；
  - 中文字形正确（抽一帧目视 + 视觉 QA 报告非恒真）；
  - 容器日志里能看到应用层 `console.error` 诊断（验证 P-1 在真实生产环境生效）。
- **禁区**：不得把 mock、fixture 或开发机产物当作生产证据（沿用 ISSUE-014 §4 口径）。

---

### P-9 · 多实例（如确有需要）—— `todo`，非上线必需

- **前置**：P-5 第二层（lease + heartbeat）。
- **落点**：`src/lib/stream/{stream-bus,status-bus}.ts` 换 Redis pub/sub。
- **要点**：两个总线必须一起换；事件协议
  （`snapshot` / `node-status` / `topology` + 单调 `seq`）可原样平移；
  ISSUE-012 的架构决策「两个总线不合并」仍然有效，换传输层不等于合并语义。

## 10. 上线前门禁清单

每次部署镜像前跑一遍：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:pg
pnpm verify:v3
pnpm build
git diff --check
```

补充检查：

1. `docker compose config` 无明文 secret；
2. 构建上下文体积合理（`.dockerignore` 生效）；
3. 迁移连续两次幂等；
4. 生产地址跑一次 `pnpm verify:e2e` 并留证。

## 11. 禁区

1. **不得为了部署方便降级任何既有门禁**：确定性红线、
   `window.__CVC_RENDER__@v1` 合同、artifact 校验、QA 判定，一律不许放宽。
2. **不得在部署批次里做应用内认证**（P-2 已说明理由）。
3. **不得把 `.env*`、`.data/`、宿主 `node_modules` 放进镜像或构建上下文**。
4. **不得合并 Next 与 worker 的 env 加载器、model routing、job 状态机**
   （AGENTS.md §0 硬边界）。
5. **不得复用开发机的 render 产物到生产**（§3.4 字体缓存错误命中）。
6. **不得把 `running` 的孤儿 attempt 静默改回 `queued` 自动重试**（P-5 禁区）。
7. **不得为迁就音轨而修改已实测的 `durationInFrames`**（P-3 禁区，
   ISSUE-005 §6 明文禁区的延伸）。

## 12. PLAN-002 登录落地后的复核（2026-07-28 追加，不改写上方历史内容）

应用内认证（PLAN-002 阶段 A+B）已落地：proxy + 页面查库校验 + 13 条 API 守卫，
业务归属收口到会话 workspace，队列按 attempt 行归属执行。逐条影响：

| 条目 | 结论 | 动作 |
| --- | --- | --- |
| P-2 接入策略 | **需要复核并降级**。P-2 仍管 Postgres 端口、worker 暴露面等应用层管不到的事；但边界形态应从 Basic Auth 降级为纯网络层，否则用户过两道认证 | 只改反代配置不动 `src/**`；更新 `docs/deployment/access.md` 并重新留证（未登录→应用 302/401；反代仍拒非白名单来源），待部署批次执行 |
| P-4 容器内并发配额 | **配额语义已拍板：进程级**（约束本机 CPU，与用户无关）。`queue.laneQuotas` 的存储锚点保留在 LOCAL workspace 行，`runtime-config.ts` 头注释已声明 | P-4 落地时沿用这个语义，不得在两处各写 CPU 探测 |
| P-5 孤儿作业回收 | **验收面扩大**：启动期回收必须跨全部 workspace 扫描，每条回收在该 attempt 自身的 workspace 上下文内走状态机 | 验收用例从「单 workspace 种一条」改为「两个 workspace 各种一条，都被正确回收且互不影响」；禁区不变 |
| P-7 生产 compose | **需补 env/secret**：`CVC_MAIL_SMTP_HOST/PORT/USER/PASS`（PASS 为 secret）、`CVC_MAIL_FROM_ADDRESS/NAME`；体验账号弹窗已移除，next 服务不再透传 `CVC_DEMO_ACCOUNT_*` | `docker compose config` 无明文 secret 的验收项把新变量纳入检查 |
| P-8 生产端到端 | **脚本已先行改造**：`e2e-smoke.ts` 支持 `CVC_VERIFY_ACCOUNT`（email:password）登录后携会话 cookie，与 Basic Auth 同一出口 | 验收新增一条：端测账号是真实注册账号，产物归属该账号的 workspace |
| P-9 多实例 | **前置条件新增一项**：会话已是 DB 持久化天然跨实例；但 `auth_throttle` 固定窗口按实例各算会变宽松 | P-9 落地时一并处理（共享计数）或明确接受并记录 |

另：本文件 §11 禁区第 2 条（不在部署批次里做应用内认证）的背景已变化：
认证由 PLAN-002 独立批次完成，该禁区继续有效（部署批次仍不得附带认证改动）。
