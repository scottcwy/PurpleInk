# PLAN-001 · P-2 / P-6 / P-7 生产部署完整修复计划

> Historical note: the current deployment contract is deploy/compose.yaml,
> deploy/Caddyfile, and docs/deployment/. This plan predates the immutable GHCR
> stack; its Basic Auth and former reverse-proxy guidance is historical only.

- 对应 issue：`docs/issues/ISSUE-015-production-issue.md` §9 的 P-2、P-6、P-7
- 计划性质：部署面从零建立 + 接入边界防护。**不改 `src/**`**（唯一例外见 §5.3）
- 撰写日期：2026-07-26
- 审查基线：`yusheng/two-part-merge`（P-1 已完成，commit `2c7d4d4`）
- 上游真值：`AGENTS.md`、`docs/conventions/routing.md`、`docs/issues/ISSUE-015-production-issue.md`
- 并行关系：与 `PLAN-002-auth-system.md`（登录体系）文件级不相交，唯一协调点是
  `docs/conventions/routing.md` §9，见 PLAN-002 §0.3

## 0. 先读这一节

### 0.1 这三项为什么必须捆在一个计划里

P-2 是策略决策，P-6 是镜像，P-7 是编排。它们不是三件独立的事：

- P-6 的"以非 root 运行""不 publish 端口"这些选择，取决于 P-2 定下的接入形态；
- P-7 的 compose 里必须有反代服务，而反代配置是 P-2 的交付物；
- 三者共用同一份持久卷与 env 约定，分开写会出现三套互相矛盾的变量名。

但**提交必须分开**（§5.2），因为三者的验收证据形态完全不同：P-2 证明"请求没到
Next"，P-6 证明"容器内 Chromium 能跑且中文不是豆腐块"，P-7 证明"重启后数据还在"。

### 0.2 不变量（任何步骤都不得违反）

1. **不改 `src/**`**。P-2 的禁区原文：不要在部署批次里实现应用内认证。
2. **不降级任何既有门禁**：确定性红线、`window.__CVC_RENDER__@v1` 合同、artifact
   校验、QA 判定，一律不许为了"能部署"而放宽（ISSUE-015 §11.1）。
3. **不合并 Next 与 worker 的 env 加载器、model routing、job 状态机**
   （AGENTS.md §0 / `docs/issues/README.md` §0 硬边界）。
4. **不把 `.env*`、`.data/`、宿主 `node_modules` 放进镜像或构建上下文**。
5. **不复用开发机的 render 产物到生产**（ISSUE-015 §3.4：缓存 key 不含字体环境，
   Windows 渲出的 MP4 会在 Linux 上被错误命中）。
6. **secret 只走 secret 通道**，`docker compose config` 输出不得含明文。

### 0.3 已核实的现状事实（写计划时实测，实施前请复核）

| 项 | 实测值 |
| --- | --- |
| `Dockerfile` / 生产 compose | 不存在 |
| `.dockerignore` | 已存在（P-1 补上） |
| `docker-compose.dev.yml` | 仅 `postgres:17.5-alpine`，端口 `127.0.0.1:54328:5432` |
| `output: 'standalone'` | 未启用 |
| `serverExternalPackages` | `ffmpeg-static`、`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core` |
| `engines` 字段 | 无 |
| `packageManager` | `pnpm@10.30.0` |
| `playwright` 声明版本 | `^1.61.1`；**实际安装 1.62.0** ← 镜像 tag 必须按实际安装版本对齐 |
| 迁移目录 | `src/lib/db/migrations/pg`，journal 4 条（`0000`–`0003`） |
| `pnpm db:migrate` | `tsx scripts/setup/db-migrate.ts`，**`tsx` 是 devDependency** |
| 产物根目录 | `DATA_DIR`（默认 `<cwd>/.data`），`ARTIFACTS_DIR = <DATA_DIR>/artifacts` |
| SSE keepalive | 两条流式路由都是 `KEEPALIVE_MS = 15_000` |
| SSE 头 | 已设 `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no` |
| 客户端订阅方式 | `new EventSource(...)`（`use-project-status-stream.ts:96`、`use-stage-stream.ts:66`） |
| worker 入口 | `next.config.ts` rewrites `/api/engine/:path*` → `BACKEND_ORIGIN`（默认 `http://localhost:8787`） |
| `/products/*` 索引状态 | 既无 `noIndex`，`robots.ts` 也只 disallow `/api/`、`/private/`、`/share/` |
| 取证脚本 | `scripts/verify/e2e-smoke.ts` 不发任何认证头 |

---

## 1. P-2 · 接入策略与边界防护

### 1.1 问题定性

不是代码 bug，是**信任边界缺失**。代码按"受信网络内的单工作区工具"设计，
`routing.md` §9.1 已显式记录该假设。缺陷发生在"把进程接到公网"这个部署动作上。

实测确认的未授权暴露链（比 ISSUE-015 §2.1 表格更严重的一条）：

```text
GET  /api/projects                          无参数无认证 → listProjects() 返回全部项目
  ↓ 取得 projectId
GET  /products/canvas/{projectId}           页面同样未授权可访问，SSR HTML 内含 artifact id
  ↓ 取得 artifactId
GET  /api/artifacts/{id}?projectId=         readArtifact() 的 where 只有
                                            workspaceId = LOCAL_WORKSPACE_ID（硬编码，恒真）
                                            AND id AND projectId → 直接吐成片字节
```

其余高危端点与后果：

| 端点 | 未认证调用的后果 |
| --- | --- |
| `POST /api/settings` | 写 provider 凭据与并发配额；且**先做真实 provider API 校验再落库**，等于把服务器当探针 |
| `POST /api/director/pipeline` | 仅需一个 `projectId` 就 `initQueue()` + 启动全管线，直接消耗 Gemini / StepFun 真实额度 |
| `POST /api/render`、`POST /api/render/export` | 拉起 Chromium + ffmpeg，CPU / 内存放大 |
| `GET /api/director/stream/**` | 每连接一个进程内订阅 + 15s keepalive 定时器，连接数放大面 |

### 1.2 决策矩阵（需用户拍板，实施前必须已定）

**硬约束先行**：客户端用同源 `EventSource`，它**不能设置自定义请求头**。因此任何
"反代校验 `Authorization: Bearer <token>`"的方案都会打断画布状态流，症状是
"页面能开、状态不更新、退回 1.5s 轮询兜底"，极难归因。**直接排除。**

| 方案 | EventSource | 人的粒度 | 取证成本 | 备注 |
| --- | --- | --- | --- | --- |
| 仅内网 + VPN | ✅ 透明 | ❌ 无 | 最低 | 最省事；依赖网络边界可信 |
| IP allowlist | ✅ 透明 | ❌ 无 | 最低 | 共享出口 IP 场景等于不设防 |
| 反代 Basic Auth | ✅ 同源自动带凭据 | ⚠️ 共享口令 | 中（脚本需带头） | **必须在 TLS 之上** |
| mTLS | ✅ TLS 层完成 | ✅ 按证书 | 高（脚本/Playwright 都要配证书） | 最强，首版不作为阻塞 |
| Cookie + 反代校验 | ✅ | ✅ | 高 | 需要签发端 = 在部署层做半个认证系统，**违反 P-2 禁区** |

**推荐组合**：网络层（IP allowlist 或仅内网 + VPN）作为第一道 + 反代 Basic Auth
over TLS 作为第二道。两道都对 EventSource 透明、都不碰 `src/**`、都能产出真实
HTTP 状态码证据。mTLS 留作后续加强。

**与 PLAN-002 的衔接**：登录体系落地后，把反代从 Basic Auth **降级为纯网络层**，
纵深防御保留、UX 上不再双重输入。该降级只改反代配置，不动 `src/**`。

### 1.3 目标拓扑

```text
                    ┌──────────────────────────────────────────┐
  公网 / 内网  ───► │ reverse-proxy  (唯一 publish：443)        │
                    │  TLS 终止 + Basic Auth + 默认拒绝         │
                    └───────────────┬──────────────────────────┘
                                    │ 仅内部 network
                    ┌───────────────▼──────────────┐
                    │ next  (3000，不 publish)      │
                    │  进程内队列 + SSE + Chromium  │
                    └───────┬───────────────┬──────┘
                            │               │ BACKEND_ORIGIN（可选）
              ┌─────────────▼──────┐  ┌─────▼─────────────────┐
              │ postgres           │  │ worker (8787)         │
              │ 不 publish 任何端口 │  │ 不 publish；不部署则   │
              │ 独立持久卷          │  │ 营销页 Try 返回 502    │
              └────────────────────┘  └───────────────────────┘
```

关键点：

1. **Next 容器不写 `ports:`**，只挂内部 network。反代是唯一 publish 的服务。
2. **Postgres 不映射任何宿主端口**。dev compose 的 `127.0.0.1:54328:5432` 整条删掉，
   生产 compose 不继承。
3. **worker 若部署也不 publish**，只经 `BACKEND_ORIGIN` 走内网被 Next rewrite 访问。
4. **健康检查走内网直连容器**（`/api/ping`），**反代上不开任何豁免路径**。开了就是
   一个永久的未认证入口。

### 1.4 反代必须做对的四件事

**a. 默认拒绝，不做路径白名单。** `/`、`/products/*`、`/playbook/*`、`/api/*`、
`/api/engine/*`、静态资源全部要求凭据。做白名单的话，将来按 `routing.md` 新增路由时
反代不会自动同步，新表面会静默漏到公网。

**b. 放行 SSE。** 应用侧已经做对（§0.3），反代侧还必须自己配：

```nginx
# 关键片段（完整配置在 docs/deployment/ 落盘）
location / {
    proxy_pass         http://next:3000;
    proxy_http_version 1.1;                 # 必须 1.1，否则无分块流
    proxy_set_header   Connection "";
    proxy_buffering    off;                 # 关缓冲
    proxy_cache        off;
    proxy_read_timeout 300s;                # 必须 > 15s keepalive，别压线
    proxy_set_header   Host              $host;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    auth_basic         "PurpleInk";
    auth_basic_user_file /run/secrets/htpasswd;
}
gzip_types text/html text/css application/javascript application/json;  # 不含 text/event-stream
```

Caddy 等价要点：默认不缓冲，`reverse_proxy` 下加 `flush_interval -1`，
`basic_auth` 用 bcrypt 哈希，超时给到 300s。

**c. 容得下慢请求。** `POST /api/settings` 会同步等 Gemini / StepFun 的真实校验往返；
产物下载可能是几十 MB 的 MP4。read timeout 与 body 限制都要按此设定。

**d. TLS 必须有。** Basic Auth 走明文 HTTP 等于把口令交出去。自签证书也可以，但要在
`docs/deployment/` 写清客户端如何信任。

### 1.5 凭据与 secret

- htpasswd 文件走 compose `secrets:` 挂载到 `/run/secrets/htpasswd`，
  **不进镜像层、不写进 compose 明文、不提交仓库**。
- 生成命令与轮换步骤写进 `docs/deployment/`，只写变量名与步骤，不写值。
- 验收项：`docker compose config` 输出里搜不到任何口令、`CVC_CREDENTIAL_MASTER_KEY`
  或 provider key 的值。

### 1.6 取证脚本的凭据入口（P-2 的连带工作）

`scripts/verify/e2e-smoke.ts` 的 `post()` 只发 `content-type`，加了反代认证后会全线
401。**且不能靠 `--base-url https://user:pass@host` 绕**——已实测，Node fetch 直接抛
`TypeError: Request cannot be constructed from a URL that includes credentials`。

做法（属于 `scripts/`，不违反"不改 `src/**`"）：

- 加一个只读 env 的凭据入口（建议名 `CVC_VERIFY_BASIC_AUTH`，格式 `user:pass`），
  在 `post()` / `get()` 统一注入 `Authorization: Basic <base64>`；
- **只引用变量名，不回显值**；未设置时行为与今天完全一致（不发头），保持本地可用；
- 这个入口后续会被 PLAN-002 的登录复用（改成携带会话 cookie），所以**只做一个出口**，
  不要在两处各写一份注入逻辑。

### 1.7 P-2 验收与证据

证据落 `docs/issues/evidence/issue-015/p2/`：

1. **未携带凭据被拒**：`POST /api/settings`、`POST /api/director/pipeline`、
   `GET /api/artifacts/{id}?projectId=`、`GET /api/projects` 四条，各留完整响应
   （状态码 + 响应头 + body）。
2. **证明请求没到达 Next**：同一时间窗内反代 access log 有记录、Next 容器日志
   **无**对应请求。这一条才是 P-2 的核心证据，只有状态码不够。
3. **携带凭据后 SSE 正常**：`GET /api/director/stream/project/{projectId}` 收到
   `node-status` 帧；且**空闲超过 15s 后仍能收到 `: keepalive`**（证明未被缓冲、
   未被提前断流）。
4. **Postgres 不可从宿主直连**：宿主上对生产 Postgres 端口的连接被拒绝。

### 1.8 P-2 禁区

1. 不在本项实现应用内认证（会牵动 `routing.md` §9 守卫矩阵与 `LOCAL_WORKSPACE_ID`
   单工作区模型，必须单开 issue → 见 PLAN-002）。
2. 不用 header token 方案（打断 EventSource）。
3. 不在反代上为健康检查、监控或 webhook 开豁免路径。
4. 不把 §9.2 的"404 掩盖归属错误"口径套到反代层——反代在应用之前，谈不上归属，
   返 401/403 是正确的。这点必须写进文档，否则以后会被误判为违规。
---

## 2. P-6 · Dockerfile

前置：P-2 决策已定（决定是否非 root、是否 publish）。P-4 未落地时用 env 兜底（§3.5）。

### 2.1 五个必须解决的运行时假设

来自 ISSUE-015 §3.3、§4，逐条对应做法：

| 假设 | 在容器内为何不成立 | 做法 |
| --- | --- | --- |
| Chromium 能 launch | `frame-capture.ts:23` 是 `chromium.launch({ headless: true })`，无 args；root 下 Chromium 拒绝启动 | **以非 root 运行**（Playwright 镜像的 `pwuser`），**不要加 `--no-sandbox`**——这个进程要加载模型生成的 HTML，沙箱是有意义的防线 |
| 浏览器版本与库对齐 | 镜像内浏览器版本必须与 `playwright` 实际安装版本匹配 | **实测安装版本是 1.62.0**（`package.json` 写 `^1.61.1`）。镜像 tag 按 1.62.0 对齐，或自行 `playwright install --with-deps chromium` 并钉死 |
| 中文字体存在 | 精简镜像缺 CJK 字体 → 每帧渲成豆腐块，而 `shot-qa` 会拿这些帧核对 `mustShow`，得到"渲染成功但内容全错"的假绿 | **显式安装 CJK 字体**（`fonts-noto-cjk`），并在验收里目视抽帧 |
| `ffmpeg-static` 有 Linux 二进制 | 它靠 postinstall 下载**平台**二进制 | **镜像内 `pnpm install`**，绝不从 Windows 宿主 `COPY node_modules`（`.dockerignore` 已排除，机制上兜住） |
| `tsx` 可用 | `pnpm db:migrate` 与 `bootstrap-credentials.ts` 走 `tsx`，它是 devDependency | 迁移单独一个含完整依赖的 stage / 一次性任务，或运行镜像保留 `tsx` |

### 2.2 基础镜像与 Node 版本

两条路，二选一并在 `docs/deployment/` 写明理由：

- **A（推荐）**：`mcr.microsoft.com/playwright:v1.62.0-noble`。浏览器与系统依赖一次到位，
  自带 `pwuser`。**必须实测 `node -v`**，不要假设镜像内 Node 版本；若低于 Next 16 要求
  （Node 20.9+ / 22）则改走 B。
- **B**：`node:22-bookworm-slim` + `pnpm playwright install --with-deps chromium`。
  Node 版本自己钉死，代价是镜像体积与构建时间。

两条路都要：

- `corepack enable` + 使用 `packageManager` 里的 `pnpm@10.30.0`，不要另装 pnpm；
- 建议给 `package.json` 补 `engines`（当前无），把 Node 版本写成真值而不是隐含约定；
- `hyperframes` 用 workspace 本地固定版本（`0.7.70`），**不允许运行时动态下载 CLI**
  （AGENTS.md §4）。

### 2.3 构建结构

```dockerfile
# 骨架示意，实施时按 §2.2 选定的基础镜像补全
FROM <base> AS deps
# corepack enable; pnpm install --frozen-lockfile
# 关键：在 Linux 内跑 install，让 ffmpeg-static 的 postinstall 下载 Linux 二进制

FROM deps AS build
# pnpm build（NODE_ENV=production）
# instrumentation.register() 有 NEXT_PHASE === 'phase-production-build' 守卫，
# 构建期不连 DB；建议在流水线里实测确认一次

FROM deps AS migrate
# 保留 devDependencies（tsx / drizzle-kit），供一次性迁移任务使用
# ENTRYPOINT ["pnpm", "db:migrate"]

FROM <base> AS runtime
# 非 root（USER pwuser）
# 安装 CJK 字体
# COPY 构建产物 + node_modules（或 standalone 输出，见 §2.4）
# EXPOSE 3000（仅文档语义，不 publish）
```

### 2.4 `output: 'standalone'` 的取舍

当前未启用。两条路都可以，但**不允许"改了配置就当验证过"**：

- **不启用**：整份 `node_modules` 进运行镜像。体积大，但零风险，且 `tsx` 天然可用。
  首版建议先走这条，把不确定性压到最低。
- **启用**：必须**实测验证** `serverExternalPackages` 里那三个包
  （`ffmpeg-static`、`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`）被正确
  带出。这三个是外部化的，standalone 的自动依赖追踪容易漏——`pi-ai` 那条正是 ISSUE-012
  踩过的 `MODULE_NOT_FOUND`（commit `5be5869`）。验证方式不是看文件在不在，而是**在容器内
  真跑一次 Director 阶段与一次单镜渲染**。

### 2.5 P-6 验收与证据

证据落 `docs/issues/evidence/issue-015/p6/`：

1. `docker build` exit 0，并记录最终镜像体积。
2. 容器内 `node -v` 与钉死版本一致。
3. 容器内 `chromium.launch()` 成功，**且进程不是 root、未使用 `--no-sandbox`**
   （留 `id` 输出与 launch 日志）。
4. 容器内渲一镜成功，**抽一帧目视确认中文不是豆腐块**（存图进证据目录）。
5. `ffmpeg-static` 的二进制存在、可执行、`-version` 有输出。
6. 若启用 standalone：容器内真实跑通一次 Director 阶段（证明三个外部包可解析）。

### 2.6 P-6 禁区

1. 不加 `--no-sandbox` 来绕 root 限制；正解是非 root。
2. 不从宿主 `COPY node_modules`。
3. 不用 `latest` 或浮动 tag；镜像、Node、浏览器版本全部钉死。
4. 不在 Dockerfile 里让 Next 与 worker 共用一份 env 或配置（AGENTS.md §0）。

---

## 3. P-7 · 生产 compose 与运行时配置

前置：P-6 已能构建出可运行镜像。

### 3.1 服务清单

| 服务 | publish | 卷 | 备注 |
| --- | --- | --- | --- |
| `reverse-proxy` | 443（唯一） | 证书 + htpasswd（secret） | P-2 交付物 |
| `next` | 无 | `DATA_DIR` 持久卷 | `replicas: 1`，见 §3.2 |
| `postgres` | 无 | 独立持久卷 | 强口令，见 §3.4 |
| `migrate` | 无 | — | 一次性任务 / init 容器，见 §3.3 |
| `worker` | 无 | 自己的 out 目录 | 可选，见 §3.6 |

### 3.2 只能单实例，且重启会留孤儿

两件事分开看（ISSUE-015 §3.1）：

- **领取本身是多实例安全的**：`InProcessQueue.claim()` 用 `FOR UPDATE SKIP LOCKED`。
- **但多实例仍不可行**：`stream-bus` 与 `status-bus` 都是进程内 + `globalThis` 锚定。
  A 实例执行作业、B 实例持有 SSE 时，画布推送与 Director 文本流会静默丢事件。

因此 compose 必须：

- `replicas: 1`；
- **recreate 而非滚动更新**（滚动会短暂并存两个实例）；
- 给足 `stop_grace_period`（建议 ≥ 120s，让在途 render / export 收尾）；
- 更新前先关 autopilot 并等队列排空（写进 `docs/deployment/` 的操作手册）。

**已知残留**：进程被 kill 时 `task_attempts.status='running'` 与
`canvas_nodes.status='running'` 会永久卡住（`stale|reclaim|heartbeat|lease|requeue`
在 `src/lib/queue/**` 零命中）。这是 **P-5** 的范围，本计划不修，但必须在
`docs/deployment/` 写清"非正常重启后需人工核对 running 记录"。

### 3.3 迁移必须在应用启动前完成，并连续跑两次

`_journal.json` 时间戳乱序曾让 `0003` 被 drizzle 判定过期而跳过，造成 schema 与 DB
不一致、全库建项目 400（ISSUE-008 / ISSUE-012）。容器化后这个风险更隐蔽。

做法：

- 用 §2.3 的 `migrate` stage 作为一次性任务 / init 容器，`depends_on: postgres healthy`；
- `next` 服务 `depends_on: migrate completed_successfully`；
- **连续执行两次**，第二次必须无变更；两次输出都存证。

### 3.4 数据、卷与 secret

- **`DATA_DIR` 指向持久卷**。它是所有媒体字节的唯一副本；卷丢失后 DB 行还在、字节全无，
  得到一批能查到 `content_hash` 却下载不了的悬空产物，而 approved / released 产物有 DB
  触发器保护不可原地更新，修复只能靠新版本。
- **用全新 artifacts 目录，不复用开发机的**。渲染与缩略图缓存 key 由 HTML 字节 + frames
  规格派生，**不含字体环境**，复用会让 Windows 渲出的 MP4 被判定命中。确需迁移历史数据时，
  明确排除 `render-mp4` / `frame-thumbnail` / `director-fabricate` 这几类可重算产物。
- **Postgres 换强口令**（dev 的 `cvc_dev_only` 只用于开发），独立持久卷，不映射端口。
- **`CVC_CREDENTIAL_MASTER_KEY` 走 secret**，不进镜像层、不进 compose 明文。它丢失
  = 所有 provider 凭据不可解密，设计上无明文 fallback。
- 若前面挂 PgBouncer 的 transaction 模式，**必须关 `prepare`**：客户端是 `postgres.js`，
  `postgres(databaseUrl)` 未传任何连接参数，默认 `prepare: true`。首版建议直连、不引入
  PgBouncer，少一个变量。

### 3.5 并发配额必须显式设置（P-4 的兜底）

P-4 未落地前，`defaultRenderShotConcurrency()` 读的是**宿主**核数
（`os.cpus()` 不读 cgroup 限制）。宿主 32 核、容器限 2 核时它会开 16 路并行渲染，
每路一个 Chromium + 一个 ffmpeg，结果是 OOMKilled。

所以生产 compose **必须显式设**：

- `CVC_QUEUE_RENDER_SHOT_CONCURRENCY`
- `CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY`

并注意 ISSUE-011 的既有语义：**DB 配额改动要重启进程才生效**，这是有意设计、UI 也如实
标注了，不要在部署时误判为"配置没生效"。

### 3.6 是否部署 worker

`/api/engine` 只被 `src/lib/api.ts` 的 `API_BASE` 使用，而它只被**一个文件**引用：
`src/components/marketing/launch-composer.tsx`。制作应用 `/products/*` 完全不依赖 worker。

- **首版建议只部署 Next + Postgres**：核心「文本 → 成片」链路完整可用，代价是营销首页的
  Try 演示 502。要么接受（反代后面本来也没有匿名访客），要么临时隐藏入口。
- 若一起部署：它是另一套系统（独立 env 模板 `server/.env.example`，含 ListenHub / IMAP；
  独立 job 状态机；需要 `sharp` 与自己的 Playwright）。**不要在 Dockerfile 或 compose 里
  图省事共用一份配置。**

### 3.7 P-7 验收与证据

证据落 `docs/issues/evidence/issue-015/p7/`：

1. `pnpm db:migrate` 连续两次均成功，第二次无变更（两次输出都存）。
2. `docker compose config` 全文搜不到明文 secret。
3. 容器重启（含 `down` + `up`）后 artifacts 与 DB 数据都还在。
4. 宿主无法直连 Postgres 端口。
5. 构建上下文体积合理（证明 `.dockerignore` 生效）。
6. 两个并发配额 env 在容器内 `printenv` 可见且为预期值。
---

## 4. 三项共同的门禁

每次提交前跑（AGENTS.md §8）：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm verify:v3
pnpm build
git diff --check
```

补充：

- 本计划**不改 `src/**`**，所以 `verify:v3` 的 architecture violations 应保持为空且
  baseline 不需要任何改动。**如果需要动 baseline，说明范围跑偏了，停下来复查。**
- 文本变更后对 `AGENTS.md README.md docs src server scripts` 做 U+FFFD 扫描。
- 涉及数据库的步骤（P-7 §3.3）另跑 `pnpm test:pg`。

## 5. 执行顺序与提交切分

### 5.1 顺序

```text
P-2 决策拍板（用户）
  └─► P-2 落地：反代配置 + compose network 草案 + docs/deployment/ 接入说明
        └─► P-6：Dockerfile（+ engines）
              └─► P-7：docker-compose.prod.yml + 运行手册
                    └─► （后续，本计划外）P-8 生产端到端验收
```

P-4 / P-5 不阻塞本计划：P-4 用 §3.5 的 env 兜底，P-5 用 §3.2 的运行手册说明兜底。

### 5.2 提交切分（每项一个 Conventional Commit）

只 stage 当前职责的文件，不要 `git add .`：

| # | 类型与摘要 | 文件 |
| --- | --- | --- |
| 1 | `chore(deploy): 反代边界防护与接入策略` | 反代配置目录、`docs/deployment/access.md`、`docs/conventions/routing.md`（§9.1 追加一段） |
| 2 | `chore(verify): 取证脚本支持 Basic 凭据` | `scripts/verify/e2e-smoke.ts`、`.env.example`（只加变量名，值留空） |
| 3 | `build(docker): 生产镜像` | `Dockerfile`、`package.json`（`engines`）、必要时 `next.config.ts`（standalone） |
| 4 | `chore(deploy): 生产 compose 与运行手册` | `docker-compose.prod.yml`、`docs/deployment/runbook.md` |
| 5 | `docs(issues): ISSUE-015 P-2/P-6/P-7 核销` | `docs/issues/ISSUE-015-production-issue.md`、`docs/issues/README.md`、证据目录 |

提交正文写清"改了什么、验证了什么"。未经用户明确授权不得 push、建 PR、force push。
保持在 `yusheng/two-part-merge` 分支，不切分支。

### 5.3 唯一允许触碰的应用侧文件

`src/**` 真正零改动。允许触碰的只有这两处，且都不在 `src/**`：

- `package.json` 的 `engines`（把 Node 版本从隐含约定变成真值）；
- `next.config.ts` 的 `output: 'standalone'`（仅当 §2.4 选了启用，且完成实测验证）。

`/products/*` 补 `noIndex`、`robots.ts` 调整**不在本计划**，归 PLAN-002。

## 6. 修复后如何更新 ISSUE-015

这一节是交付物的一部分，不是可选步骤。ISSUE-015 是这批工作的账本，账不平等于没做完。

### 6.1 逐条改哪里

**P-2 条目**（§9 的 `### P-2 · 定接入策略并落地边界防护 —— decision + todo`）：

1. 标题状态 `decision + todo` → `done`。
2. 在"需要你先决策"那一行下面补一行 **决策结论**：选了哪个组合、为什么（至少写明
   EventSource 不能带自定义头这条硬约束）。
3. 补 `**commit**：<sha>` 一行，与 P-1 的写法一致。
4. 把 §1.7 的四类证据落到"**验收**（已核销）"，逐条写实测结果与证据文件路径，
   **不要只写"已验证"**。
5. 保留"禁区"段原文不动。

**P-6 条目**：状态 `blocked` → `done`；补 commit、镜像 tag、`node -v` 实测值、
standalone 取舍结论；验收四条改成实测结果 + 证据路径（含那张中文抽帧图）。

**P-7 条目**：状态 `blocked` → `done`；补 commit；写明是否部署 worker 及理由、
两个并发配额 env 的实际取值、迁移两次的输出路径。

**P-8 条目**：`blocked`（等 P-7）→ `todo`，并补一句前置已满足。

### 6.2 §1 现状基线表要同步

`### 1. 现状基线（2026-07-26 实测）` 那张表里这几行已经过期，必须改：

| 行 | 改成 |
| --- | --- |
| `Dockerfile` / 生产 compose | 已落盘，路径 + commit |
| `output: 'standalone'` | 按 §2.4 的实际结论 |
| `engines` 字段 | 已补，值 |
| 认证守卫 | **改成分层表述**：入站边界由部署层保证（反代 + 网络层）；应用内认证仍未落地（见 PLAN-002）。**不得简单写成"已实现"** |
| 队列位置 | 不变（仍在 Next 进程内） |

### 6.3 §2.1「零认证，不得暴露公网」要改写而不是删除

改写要求（这是最容易做错的一步）：

- **保留问题描述**，它是历史证据；
- 在开头加一段"当前处置"：入站由反代 + 网络层拒绝未授权请求，证据见 `evidence/issue-015/p2/`；
- **明确写清残留风险**：拿到凭据的任何人仍是全权管理员（无租户、无角色、无审计）；
  产物 URL 仍携带内部 `projectId`；`LOCAL_WORKSPACE_ID` 仍是硬编码。P-2 只是把
  "公网任意人"收敛成"受信网络内任意人"；
- 指向 PLAN-002 与后续的认证 issue。

### 6.4 §9 顶部的状态行与 §0 结论

- 文件头 `- 状态：in-progress（P-1 已完成，见 §9）` → 改成 `in-progress（P-1/P-2/P-6/P-7 已完成，见 §9）`。
- §0 结论里"**部署面是空的**：仓库没有 `Dockerfile`、没有生产 compose"这句已不成立，
  改成"部署面已落盘（P-6/P-7），剩余阻塞项为成片音轨（P-3）"。
- §0 第 1 点"两个真正的上线阻塞项——零认证、成片无音轨"→ 零认证部分改为"入站已由部署层
  收敛，应用内认证另计"。

### 6.5 联动文档

| 文档 | 改什么 |
| --- | --- |
| `docs/issues/README.md` §4 贯穿表 | ISSUE-015 那行的"主要落点"补 P-2/P-6/P-7 已完成 |
| `docs/conventions/routing.md` §9.1 | **只追加**一段"入站边界现由部署层保证"，**不动 §9.2 / §9.3**（§9.3 的改写归 PLAN-002，避免两边同时改同一段） |
| `docs/deployment/`（新增） | 接入说明 `access.md` + 运行手册 `runbook.md`：更新流程、非正常重启后 running 记录的人工核对、卷备份、口令轮换 |
| `.env.example` | 只加变量名（`CVC_VERIFY_BASIC_AUTH` 等），值留空 |

### 6.6 核销自检

改完 ISSUE-015 后逐条确认：

1. 没有任何一处写着"已验证"却没有对应证据文件；
2. 没有把"部署层保证"表述成"应用内认证已实现"；
3. §11 禁区一条都没删；
4. 三个新增 `done` 条目都带 commit sha；
5. 全文无 U+FFFD。

## 7. 风险与回滚

| 风险 | 触发信号 | 处置 |
| --- | --- | --- |
| 反代破坏 SSE | 画布状态不更新、退回轮询；`: keepalive` 收不到 | 检查 `proxy_buffering` / `proxy_http_version` / read timeout；不要改应用侧头（已正确） |
| 反代默认拒绝把静态资源也拦了导致页面白屏 | 页面 HTML 200 但 JS/CSS 401 | 保持默认拒绝，但确认浏览器对同源子请求会带 Basic 凭据；不要为静态资源开豁免 |
| 容器内 Chromium 启动失败 | launch 抛错、提示 root / 缺依赖 | 回到 §2.1，走非 root + 匹配版本，**不要加 `--no-sandbox`** |
| 中文豆腐块 | 抽帧目视全是方块，但 `shot-qa` 报绿 | 装 CJK 字体后**重渲**，不要复用已缓存的错误产物 |
| standalone 缺包 | 运行时 `MODULE_NOT_FOUND`（尤其 `pi-ai`） | 回退到不启用 standalone（§2.4） |
| OOMKilled | 容器反复重启，日志停在 render 阶段 | 确认 §3.5 两个 env 已设且 ≤ 容器 CPU 限额 |
| 迁移被跳过 | 建项目 400、schema 与 DB 不一致 | 核对 `_journal.json` 时间戳单调递增；连续跑两次验证 |
| 孤儿 running 记录 | 画布节点永久 running | 本计划不修（P-5）；按运行手册人工核对，**不得静默把 running 改回 queued 自动重试** |

回滚粒度：P-2 改配置重载即可；P-6 / P-7 回退到上一个镜像 tag 与上一份 compose。
**数据卷不参与回滚**——任何涉及删卷的操作都要先取得用户明确授权。
