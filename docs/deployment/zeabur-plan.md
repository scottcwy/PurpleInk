# Zeabur 部署方案（2C4G 服务器 + Cloudflare 免费额度）

> 状态：已定稿待实施。实施在专用分支进行，本文档是该分支的执行依据。
> 决策日期：2026-07-31。定价与平台能力均经当日官方页面核实。

## 0. 已定决策

| 决策项 | 结论 | 依据 |
| --- | --- | --- |
| 计算 | Zeabur 购买服务器 2C4G，固定月费 | ffmpeg×5 处 spawn、chromium.launch×2 处、进程内队列需常驻真机 |
| 订阅 | Zeabur Dev 档 $5/月 | 需要数据库备份导出、7 天日志；Free 档无备份功能 |
| 数据库 | Zeabur 面板一键 PostgreSQL（同服务器，挂卷） | 保持 localhost 级延迟；AGENTS.md §6 禁止 SQLite（D1 已否决） |
| 产物存储 | Cloudflare R2（免费额度 10GB，egress 永久免费） | 视频分发 egress 是成本大头，R2 是唯一免 egress 的 S3 系服务 |
| 下载路径 | 预签名 URL + 302，不再由 Next 缓冲整文件 | 现有 `api/artifacts/[id]/route.ts` 整文件进内存，是待修缺陷 |
| 入口 | Zeabur 网关（域名 + 自动 TLS）；Cloudflare Access 为可选加固 | Caddy 不随迁：basic_auth / CVC_ALLOWED_CIDRS / 自签证书均退役 |
| 服务间通信 | Zeabur 服务内网 `<服务名>.zeabur.internal`；web→worker 经构建期 `BACKEND_ORIGIN` ARG 注入 | 已核实官方私网文档；`Dockerfile.web` 已改 ARG 可覆盖，默认值保持 compose 的 `worker:8787` |
| 数据库备份载体 | 独立常驻 `backup` 服务（`Dockerfile.backup`，Node 调度每日 pg_dump → R2） | Zeabur 无原生 cron 服务类型；平台卷自动备份仅作兜底双保险 |
| 镜像构建 | 首选 Zeabur 直连 GitHub 构建；备选 CI 推 GHCR 预构建镜像 | Free/Dev 档构建机为 2C4G，若 Next 构建超时则切备选 |
| 不迁移项 | Vercel / Supabase / Cloudflare Containers / D1 | 本轮评估已逐一否决，结论见对话记录与本文 §7 |

## 1. 目标拓扑

```
用户 ──→ Zeabur 网关（域名 + TLS）──→ web 服务（Dockerfile.web, Next.js）
                                          │ 项目内私网（*.zeabur.internal）
                                          ├──→ worker 服务（Dockerfile.worker, 渲染引擎）
                                          │      不暴露公网，鉴权走 PURPLEINK_ENGINE_INTERNAL_KEY
                                          ├──→ postgres 服务（Zeabur PG 模板 + 持久卷）
                                          └──→ backup 服务（Dockerfile.backup, 每日 pg_dump）
用户下载视频 ──→ Cloudflare R2（预签名 URL 直连，不经过服务器带宽）
每日备份     ──→ pg_dump -Fc ──→ R2（免费额度内，$0）
```

与 `deploy/compose.yaml` 五服务编排的对应关系：

| compose 服务 | Zeabur 去向 |
| --- | --- |
| postgres | 面板一键 PG 模板（postgres:18，挂卷） |
| migrate | 独立服务 `migrate`（Dockerfile.migrate 自动匹配），每次发版后手动触发一次 |
| caddy | **退役**。TLS/域名由 Zeabur 网关承担；边缘登录墙可选 Cloudflare Access |
| web | 服务名 `web`，自动匹配 Dockerfile.web，挂卷 `/app/.data` |
| worker | 服务名 `worker`，自动匹配 Dockerfile.worker，仅私网可达 |
| （新增）backup | 服务名 `backup`，自动匹配 Dockerfile.backup，每日 pg_dump 落 R2（§4.3） |

Dockerfile 零改动（web 的 `BACKEND_ORIGIN` 已改构建期 ARG，默认值不变）：Zeabur monorepo
约定即 `Dockerfile.[服务名]` 自动匹配（官方文档 Deploying with Dockerfile，2026-05-12 版），
仓库四个 Dockerfile 命名恰好符合。Zeabur 不支持 docker-compose YAML；服务编排已固化为
`deploy/zeabur.template.yaml`（五服务，可从 YAML 一键创建），也可面板逐个创建。

## 2. 代码改造（唯一一期，与部署平台无关）

任何目标平台都需要这份改造，不存在返工风险。

### 2.1 S3 写穿存储适配器

- 新增 `src/lib/storage/s3-mirror.ts`，实现现有 `StorageAdapter` 接口，内部组合 local-fs：
  - `put`：写本地 + 异步推 R2；`get`：本地命中直读，未命中从 R2 拉回本地再返回
  - `localPath`：原样返回本地路径 —— 已排查 11 处调用点（render 7 文件 + director/session-store）全部零改动
  - `tempDir` / `readLocalFile` / `removeTempDir`：透传 local-fs，临时文件不上 R2
  - `exists` / `delete`：本地 + R2 双端
- 冷启动补偿：`localPath()` 是同步方法，服务器重建后旧产物只在 R2。在渲染入口
  （`admission.ts` / `export-service.ts`，本就是 async）前置 `ensureLocal(key)` 预热
- 开关：`STORAGE_MODE=local|s3-mirror`，默认 local，本地开发与现有测试行为完全不变
- 依赖：`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`（标准 S3 协议，
  R2 / Supabase Storage / MinIO 仅换 endpoint，无厂商锁定）

### 2.2 产物下载改预签名 URL

- `src/app/api/artifacts/[id]/route.ts`：鉴权后生成短时效预签名 URL，返回 302
- `STORAGE_MODE=local` 时保留现有字节流路径（本地开发不依赖 R2）
- 同步更新对应契约测试

### 2.3 配置面

`.env.example` / `deploy/env.example` 新增（只列变量名，值来自各控制台）：

```
STORAGE_MODE=s3-mirror
S3_ENDPOINT=            # R2: https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PRESIGN_TTL_SECONDS=300
```

验证门槛（RED → GREEN）：适配器单测 + 下载路由契约测试先行；
`pnpm lint / typecheck / test / verify:v3 / build` 全绿后才进入平台配置期。

## 3. Cloudflare 侧配置（只用免费额度）

| 步骤 | 操作 | 产出（填入 Zeabur 环境变量） |
| --- | --- | --- |
| R2 开通 | 控制台启用 R2（需绑卡，免费额度内不扣费） | — |
| 建桶 | 桶名 `purpleink-artifacts`，区域 Auto | `S3_BUCKET` |
| API Token | R2 Token，权限 Object Read & Write，限定该桶 | `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` |
| Endpoint | 账户级 S3 端点 | `S3_ENDPOINT` |
| （可选）Access | 域名托管到 CF 后，对 `app.<域名>` 建登录策略 | 替代已退役的 basic_auth |

免费额度红线（超出即计费，均为当前官方数字）：存储 10 GB-月、写 100 万次/月、
读 1000 万次/月、egress 永久 $0。预估用量长期低于红线；逼近时的第一优先动作是
清理过期备份而非升级付费。

## 4. Zeabur 侧配置

### 4.1 购买与订阅

1. 订阅 Dev 档（$5/月，前 14 天免费）
2. 购买服务器：筛选 2 vCPU / 4 GB，**磁盘 ≥ 40 GB**（两镜像 5.4/5.7 GB + PG 卷 +
   `.data/` 工作区 + 构建缓存），区域选目标用户近端；下单页同时核对 Egress 限额
3. 绑定支付方式并保持余额：**到期 1 天断电、7 天连数据永久删除**，这是本方案
   最大的单点运维风险，必须配置自动续费 + 日历提醒双保险

### 4.2 服务创建顺序

> 推荐用 `deploy/zeabur.template.yaml`（从 YAML 创建模板）一键生成五个服务，
> 再按下面顺序补配置；面板逐个创建见 `docs/deployment/zeabur-setup.md` §3 路径 B。

1. `postgresql`：面板 PG 模板（postgres:18），挂持久卷；记录私网主机名
   （形如 `postgresql.zeabur.internal`）与 `POSTGRES_PORT`（默认 5432），
   连接串引用变量 `POSTGRES_CONNECTION_STRING`（官方模板已 expose）
2. `migrate`：Git 服务，服务名 `migrate` 自动匹配 Dockerfile.migrate；
   `DATABASE_URL` 引用 `POSTGRES_CONNECTION_STRING`；首次部署跑一次，之后每次
   发版手动 Redeploy 触发。验收口径沿用 deploy/README.md：迁移连续执行两次，第二次必须
   幂等无报错。跑完退出后如被平台自动重启（幂等无害），在面板 Suspend
3. `worker`：Git 服务，服务名 `worker`；**不绑定公网域名**，仅私网可达；
   注入引擎所需变量（`PURPLEINK_ENGINE_INTERNAL_KEY` 等，清单见
   `docs/deployment/zeabur-setup.md` §2.2）
4. `web`：Git 服务，服务名 `web`；绑定域名（Zeabur 网关自动 TLS）；
   挂卷 `/app/.data`；注入 `DATABASE_URL`（引用 PG 连接串）、
   `BACKEND_ORIGIN=http://worker.zeabur.internal:8787`（**构建期 ARG**，
   next.config.ts rewrites 内联，改动需重新部署生效）、S3 五变量及其余 `.env` 项
5. `backup`：Git 服务，服务名 `backup`；仅私网；注入 `DATABASE_URL` + S3 五变量
6. 环境变量全部通过面板注入，禁止写入镜像；密钥值不进 Git、不进本文档

### 4.3 备份（每日，落 R2）

- 载体：`backup` 服务（`Dockerfile.backup`，node:24 + postgresql-client-18 + tsx）
  常驻运行 `scripts/backup/schedule.ts`：启动 10s 后首跑，成功后每 24h 一次，
  失败 1h 后自动重试。不用 crond 的原因：容器 env 不进 cron 环境，secret 落盘
  违反凭据约束；Node 调度天然继承容器 env
- 流程：`pg_dump -Fc` → 按实际字节算 SHA-256 → 上传 R2 → HeadObject 核对字节数
  → 轮转删除超出 `PG_BACKUP_RETAIN`（默认 14）的旧备份
- 客户端大版本与 Zeabur 官方 PG 模板（postgres:18）对齐；面板换版本时同步改
  `postgresql-client-XX`
- 双保险：Zeabur 平台对持久卷的自动备份（每日固定时段）作为 PG 数据目录兜底，
  恢复走面板下载 `data.sql`；R2 备份是 SQL 级异地副本
- **恢复演练是验收项**：从 R2 拉最新备份恢复到全新 PG 实例并通过冒烟，
  未演练过的备份视同不存在

## 5. 验收清单（改编自方案 A runbook §4，该文档已随方案 A 退役；
Caddy/宿主项已按新拓扑替换，逐项操作见 `docs/deployment/zeabur-setup.md` §5）

1. `web` 域名 HTTPS 可达：`/` 200、`/login` 200、`/products` 307
2. `worker` 无公网入口；由 `web` 侧 `/api/engine/*` 反代链路验证 `/health` 200
3. Chromium 在容器内以非 root 运行且无 `--no-sandbox`；ffmpeg-static 二进制可执行
4. 迁移连续执行两次幂等
5. 真实渲染一条视频：产物出现在 R2；下载走 302 预签名 URL；
   `ffprobe` 校验 + `content_hash` 与实际字节 SHA-256 一致
6. 重启 `postgres` 服务后业务数据保留（卷持久化生效）
7. 服务器重建演练：重建后旧产物经 `ensureLocal` 从 R2 回填，渲染链路可继续
8. 备份恢复演练通过（见 §4.3）
9. 面板确认各服务内存水位：4 GB 上限内 web + worker + PG 并发渲染不 OOM；
   若渲染并发触顶，先降低队列并发再考虑升配（升级单向，不可降配）

## 6. 成本汇总

| 项 | 月费 |
| --- | --- |
| Zeabur Dev 订阅 | $5 |
| 2C4G 服务器（按选购页实价，量级参考） | $5–15 |
| Cloudflare R2 / Access / DNS | $0（免费额度内） |
| **合计** | **$10–20** |

## 7. 已否决路线备忘（避免重复评估）

| 路线 | 否决原因（要点） |
| --- | --- |
| Cloudflare Workers/Pages | 无子进程、无可写 FS、无跨请求内存（8 处 globalThis 单例失效）、响应即回收 |
| Cloudflare Containers | 免费档不可用；常驻 $60–88/月；磁盘 ephemeral 撞 Artifact 不可变约束 |
| Cloudflare D1 | SQLite 违反 AGENTS.md §6；32 处交互式事务 + 3 处 FOR UPDATE SKIP LOCKED 无等价物；仅 Workers 内可达 |
| Vercel | 响应体 4.5 MB 上限、bundle 250 MB 装不下 Chromium、无常驻队列、SSE 跨实例失效；Hobby 禁商用 |
| Supabase（本轮暂不用） | 托管 PG 本身合格；因数据库随 Zeabur 同机部署更简单而暂缓。留作多机扩展时的迁移目标，路径：pg_dump 导入 + 改 DATABASE_URL（用 Session pooler 5432 端口，避开 Transaction pooler 的 prepared statements 限制） |

## 8. 实施分期与提交切分（新分支执行）

| 期 | 内容 | 提交类型 | 前置依赖 |
| --- | --- | --- | --- |
| P1 | S3 写穿适配器 + 单测 | feat(storage) | 无，可立即开工 |
| P2 | 预签名 URL 下载路由 + 契约测试 | feat(artifacts) | P1 |
| P3 | env.example 双文件 + 本文档随实况修订 | docs(deploy) | P1 |
| P4 | 备份脚本（scripts/ 下，配 R2 目标）+ `Dockerfile.backup` + 常驻调度 | feat(scripts) | P1 |
| P5 | Zeabur 面板配置 + 验收 §5 全项（执行见 `docs/deployment/zeabur-setup.md`） | 无代码提交，证据回填本文档 | P1–P4 + 用户开通账号 |

P1–P4 不依赖任何外部账号，本地即可完成并全量验证；
P5 需要用户先完成：Zeabur 注册/订阅/购机、Cloudflare R2 开通、（可选）域名托管。
