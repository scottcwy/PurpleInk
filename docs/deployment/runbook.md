# 生产运行手册（P-6 / P-7）

- 对应：`docs/issues/ISSUE-015-production-issue.md` §9 P-6/P-7，
  `docs/plans/PLAN-001-p2-p6-p7-production-deployment.md` §2、§3
- 前置：已完成 `docs/deployment/access.md`（P-2）的反代与凭据配置

## 1. 镜像清单

| 镜像 | Dockerfile | 构建上下文 | 说明 |
| --- | --- | --- | --- |
| `purpleink-next` | `Dockerfile`（根） | 仓库根 | 制作应用，四阶段：`deps` / `build` / `migrate` / `runtime` |
| `purpleink-worker` | `server/Dockerfile` | 仓库根（workspace 依赖） | 采集/渲染 worker，两阶段：`deps` / `runtime` |
| `purpleink-reverse-proxy` | `deploy/reverse-proxy/Dockerfile` | `deploy/reverse-proxy` | Caddy 反代 |

```powershell
docker compose -f docker-compose.prod.yml build
```

## 2. 基础镜像选型结论（P-6 §2.2 的实测结果）

计划草稿推荐的选项 A——`mcr.microsoft.com/playwright:v1.62.0-noble` /
`:v1.62.0`——在实施当下（2026-07-26）实测 `docker pull` 均返回
`not found`（两个 tag 都试过），尽管 Playwright 官方文档列出了这些 tag 名。
不排除是镜像仓库同步延迟。**因此改走选项 B**：

- 基础镜像：`node:22-bookworm-slim`（实测 `node -v` = `v22.23.1`，满足 Next 16
  要求的 Node 20.9+ / 22，也满足新补的 `package.json` `engines.node`
  `>=22.11.0`）；
- Chromium 系统依赖：`playwright install-deps chromium`（root 阶段）；
- Chromium 二进制：以非 root 用户 `pwuser` 执行 `playwright install chromium`，
  下载到 `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`（提前 `chown` 给
  `pwuser`，避免 root 下载后非 root 用户无权限访问）；
- 浏览器版本对齐：两条 `RUN` 都用
  `` node -p "require('./node_modules/playwright/package.json').version" ``
  取 `node_modules` 里实际安装的 playwright 版本，而不是硬编码
  `package.json` 声明的 `^1.61.1`。

如果后续该官方镜像 tag 恢复可用，可切回选项 A 以缩短构建时间，但仍需重新走一遍
本文件 §4 的验收步骤。

## 3. 环境变量（compose `.env`，不提交仓库）

`docker-compose.prod.yml` 用到的变量，建议放进仓库根新建的、**已加入
`.gitignore` 的** `.env`（docker compose 默认读取项目目录下的 `.env`）：

| 变量 | 说明 |
| --- | --- |
| `POSTGRES_PASSWORD` | 生产强口令，不得沿用 dev 的 `cvc_dev_only`；缺失时 compose 会直接报错拒绝启动 |
| `CVC_CREDENTIAL_MASTER_KEY` | provider 凭据加密主密钥；丢失 = 所有凭据不可解密，无明文 fallback |
| `CVC_MANAGED_STEPFUN_API_KEY` | Next 托管 StepFun 服务凭据；只进入服务端进程 |
| `CVC_MANAGED_MIMO_API_KEY` | Next 托管 MiMo 服务凭据；只进入服务端进程 |
| `CVC_MANAGED_GEMINI_API_KEY` | Next 托管 Gemini 服务凭据；只进入服务端进程 |
| `CVC_REDEMPTION_CODE_PEPPER` | 一次性兑换码域分离 HMAC pepper；不得轮换后丢失旧值 |
| `CVC_QUEUE_RENDER_SHOT_CONCURRENCY` | P-4 未落地前的强制项；按目标容器 `--cpus` 上限设置，建议 ≤ `floor(cpus/2)` |
| `CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY` | 同上 |
| `CVC_ALLOWED_CIDRS` | 反代 IP 过滤网段，留空默认放行所有（不设防），生产必须收紧 |
| `STEP_API_KEY` / `GEMINI_API_KEY` / `LISTENHUB_API_KEY` 等 | worker 的 provider 凭据，见根 `.env.example` 的 worker 段 |
| `STEPFUN_API_KEY` | **可选**。Next 侧凭据 bootstrap 用；留空则默认复用 `STEP_API_KEY` 的值 |
| `CVC_DEMO_ACCOUNT_EMAIL` / `CVC_DEMO_ACCOUNT_PASSWORD` | **可选**。设置后 `seed-demo-account` 服务自动创建该体验账号；登录页的体验账号提示弹窗已移除，这组变量不再下发到浏览器 |
| `CVC_DEMO_ACCOUNT_NAME` | 可选，体验账号显示名（仅建号脚本消费） |

### 3.1 Next 侧平台托管与 BYOK 凭据怎么进去

三家内置托管服务只读取 `CVC_MANAGED_STEPFUN_API_KEY`、
`CVC_MANAGED_MIMO_API_KEY`、`CVC_MANAGED_GEMINI_API_KEY`。这些变量由 compose
显式注入 Next 服务，不进入数据库、客户端或日志，也不会回退到旧的
`STEPFUN_API_KEY` / `GEMINI_API_KEY`。自定义 OpenAI-compatible 的 BYOK 凭据仍走
`provider_credentials` 加密表，不消耗平台成本池。

部署前运行 `pnpm verify:managed-services`。输出只包含变量名与
`configured` / `missing`，不会打印值；任何缺失都会以退出码 1 阻止错误部署。

历史 BYOK 凭据 bootstrap 仍是一个**启动前的一次性任务**，由 compose 的
`bootstrap-credentials` 服务完成（用 `migrate` target 镜像，它含 `tsx` 与源码）：

```
migrate → bootstrap-credentials ┐
       └→ seed-demo-account     ├→ next
```

两者都是 `next.depends_on` 的 `service_completed_successfully`，所以容器起来时凭据
已经在库里。三家内置托管服务不依赖这一步，终端用户也不需要填写平台 Key。

- 提供了 Key：脚本先调真实 API 校验，通过才写入；校验失败退出 1，**故意阻断启动**
  （配置错了必须响）。首次部署要盯这个容器的日志，它需要构建环境能出网。
- 没提供 Key：`--allow-empty` 让它如实提示并退出 0，不阻断启动。应用没有凭据也能
  正常起，凭据只在跑管线时才需要；此时用户仍可经设置页自行写入。

轮换 Key 有两条等价路径：改 `.env` 后重跑
`docker compose -f docker-compose.prod.yml run --rm bootstrap-credentials`，
或直接在设置页 `POST /api/settings`（真实校验、422 不覆盖已有值）。

### 3.2 体验账号（路演 / 评审）

`seed-demo-account` 服务在 `CVC_DEMO_ACCOUNT_EMAIL` 与 `CVC_DEMO_ACCOUNT_PASSWORD`
**同时非空**时创建一个 owner 账号并绑到 `LOCAL_WORKSPACE_ID`；任一缺失则原地退出 0，
什么都不做。登录页据同一对变量决定是否显示体验账号弹窗。

正式对外运营时删掉这两个变量即可，不必改 compose——账号不建、弹窗不出现。
这两个变量刻意**不是** `NEXT_PUBLIC_*`：那会在构建期内联进客户端 bundle，之后无法
关掉、也无法在不重新构建的情况下换账号。

`docker compose config` 核对无明文 secret 时，注意上表这几个变量的值不会出现在
输出里（它们是 `${VAR}` 引用，值来自宿主 `.env`，`compose config` 只回显解析
后的值——所以**这条验收必须在没有设置真实值的干净环境跑，或对输出做脱敏后再
核对**，不能想当然认为「用了变量引用就等于没有明文」。

## 4. 验收步骤（P-6 + P-7）

按 `ISSUE-015` §9 P-6/P-7 与 `PLAN-001` §2.5/§3.7 的证据要求，证据落
`docs/issues/evidence/issue-015/p6/` 与 `.../p7/`：

```powershell
# 1. 构建
docker compose -f docker-compose.prod.yml build

# 2. node 版本
docker run --rm purpleink-dev-next node -v

# 3. Chromium 非 root、无 --no-sandbox
docker run --rm purpleink-dev-next id
docker run --rm purpleink-dev-next node -e "require('playwright').chromium.launch({headless:true}).then(b=>b.close()).then(()=>console.log('launch ok'))"

# 4. ffmpeg-static 二进制
docker run --rm purpleink-dev-next node -e "console.log(require('ffmpeg-static'))"
docker run --rm --entrypoint sh purpleink-dev-next -c "$(node -e "console.log(require('ffmpeg-static'))") -version | head -n 1"

# 5. 迁移连续两次
docker compose -f docker-compose.prod.yml up postgres -d
docker compose -f docker-compose.prod.yml run --rm migrate   # 第一次
docker compose -f docker-compose.prod.yml run --rm migrate   # 第二次，必须无变更

# 6. compose 配置无明文 secret（在未设置真实 .env 值的环境跑）
docker compose -f docker-compose.prod.yml config

# 7. 重启后数据保留
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d
# 核对 cvc_data / cvc_postgres_prod 卷内容还在

# 8. 宿主无法直连 Postgres
Test-NetConnection -ComputerName localhost -Port 5432
```

## 5. 单实例与重启（P-7 §3.2）

- `next` 服务只允许 1 个实例；更新用 **recreate**（`docker compose up -d
  --force-recreate next`），不要滚动更新——滚动会短暂并存两个实例，触发
  `stream-bus` / `status-bus` 的 `globalThis` 单进程假设失效。
- `stop_grace_period: 120s` 已在 compose 里设置，给在途 render / export
  留收尾时间。
- 更新前建议：确认队列已排空（画布无 `running` 节点）再执行 recreate。
- **已知残留（P-5 未落地）**：非正常重启（OOMKilled、节点漂移、`docker kill`）
  会让 `task_attempts.status='running'` 与 `canvas_nodes.status='running'`
  永久卡住，`src/lib/queue/**` 目前没有 lease / heartbeat / reclaim 机制。
  非正常重启后必须人工核对：

  ```sql
  select id, project_id, status from canvas_nodes where status = 'running';
  select id, status from task_attempts where status = 'running';
  ```

  **不得**把这些记录静默改回 `queued` 自动重试（可能已产生部分副作用）；
  按实际情况人工判断是否需要新开一次尝试。

## 6. 数据卷与备份

| 卷 | 内容 | 备份建议 |
| --- | --- | --- |
| `cvc_data` | `DATA_DIR`（`.data/artifacts` 等），媒体字节唯一副本 | 定期离线备份；卷丢失 = DB 行还在但字节全无，且 approved/released 产物不可原地恢复 |
| `cvc_postgres_prod` | Postgres 数据目录 | 走 Postgres 常规备份（`pg_dump` / WAL 归档），不要只靠卷快照 |
| `cvc_caddy_data` / `cvc_caddy_config` | Caddy 自动 TLS 证书与状态 | 可重建（重新签发），非关键 |
| `cvc_worker_out` / `cvc_worker_capture` | worker 采集/渲染中间产物 | 可重算，非关键 |

**不复用开发机的 `cvc_data`**：渲染与缩略图缓存 key 不含字体环境，Windows 渲出
的 MP4 会在 Linux 生产环境被错误判定命中。确需迁移历史数据时，明确排除
`render-mp4` / `frame-thumbnail` / `director-fabricate` 这几类可重算产物。

## 7. 凭据轮换

- **Basic Auth**：替换
  `deploy/reverse-proxy/secrets/basic_auth_credentials` 内容后
  `docker compose -f docker-compose.prod.yml restart reverse-proxy`，
  不需要重建镜像。
- **`CVC_CREDENTIAL_MASTER_KEY`**：目前是手工操作，走 secret 管理（不进
  `.env` 明文长期存放；仅在启动 compose 时注入进程环境）。
- **平台托管 provider Key（Gemini / StepFun / MiMo）**：更新 secret 管理中的
  `CVC_MANAGED_*` 后重启 Next；设置页不得写入或显示这些值。
- **BYOK provider Key**：走设置页 `POST /api/settings`（真实 API 校验、失败 422
  且不覆盖已有值）。

## 8. 是否部署 worker（本次选择：一起部署）

`worker` 服务已加入 `docker-compose.prod.yml`，不 publish，`next` 通过
`BACKEND_ORIGIN=http://worker:8787` 内网访问（`next.config.ts` 的
`/api/engine/:path*` rewrites 消费）。注意事项：

- `worker` 是独立系统，但与 `next` 共用根 `.env.example` / `.env.local` 唯一
  env 文件（模板按进程分组，见 `docs/configuration/credentials.md` §1）；
  compose 里两个服务的 `environment` 块仍刻意分开写，不引用同一份变量列表。
- `worker` 健康检查是 `GET /health`（Node 内置 HTTP 服务自带路由），与 `next`
  的 `GET /api/ping` 互不影响。
- `worker` 同样需要 CJK 字体与 Chromium（`server/Dockerfile` 已装），因为它的
  采集/截图链路也过 Playwright。
