# Zeabur 部署操作手册（评审用）

> 执行依据：`docs/deployment/zeabur-plan.md`（已定稿）。本文件是把那份方案落成
> Zeabur 面板/CLI 可执行步骤的操作清单，并列出评审前需要准备的全部输入。
> 代码侧改造（S3 写穿、预签名下载、备份脚本）已在 `zeabur/deploy` 分支完成。

## 1. 目标拓扑（回顾）

```
用户 ──→ Zeabur 网关（域名 + TLS）──→ web 服务（Dockerfile.web, Next.js）
                                          │ 项目内私网（*.zeabur.internal）
                                          ├──→ worker 服务（Dockerfile.worker）无公网域名
                                          ├──→ postgresql 服务（postgres:18 + 持久卷）
                                          └──→ backup 服务（Dockerfile.backup，每日 pg_dump）
用户下载视频 ──→ Cloudflare R2（预签名 URL 直连，不经过服务器带宽）
每日备份       ──→ pg_dump -Fc ──→ R2 backups/postgres/（backup 服务执行，保留 14 份）
```

服务名 ↔ Dockerfile 自动匹配（Zeabur 约定 `Dockerfile.[服务名]`，已核实官方文档）：

| 服务名 | Dockerfile | 公网 | 备注 |
| --- | --- | --- | --- |
| `postgresql` | 官方模板 postgres:18 | 无（面板 TCP 转发仅运维用） | 挂持久卷 |
| `web` | `Dockerfile.web` | **是**（绑定域名） | 挂卷 `/app/.data` |
| `worker` | `Dockerfile.worker` | **否** | 仅私网 |
| `migrate` | `Dockerfile.migrate` | 否 | 一次性任务 |
| `backup` | `Dockerfile.backup` | 否 | 常驻调度 |

## 2. 评审前需要准备（外部输入）

### 2.1 账号与资源（必须先完成）

| 项 | 要求 | 说明 |
| --- | --- | --- |
| Zeabur 账号 | 注册 + Dev 订阅（$5/月） | 需要数据库备份导出、7 天日志 |
| Zeabur 服务器 | 2C4G，**磁盘 ≥ 40 GB** | 两镜像 + PG 卷 + `.data` + 构建缓存 |
| Cloudflare R2 | 开通（需绑卡，免费额度内 $0） | 桶 `purpleink-artifacts`，区域 Auto |
| R2 API Token | 权限 **Object Read & Write**，限定该桶 | 填入 `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` |
| R2 S3 端点 | `https://<account-id>.r2.cloudflarestorage.com` | 填入 `S3_ENDPOINT` |
| 域名 | 可选；`shuheng.cloud` 子域或先 `.zeabur.app` | 评审可先用 Zeabur 免费子域 |

### 2.2 密钥清单（部署时填入面板，禁止进 Git / 对话 / 文档）

生成方式标注在括号里：

| 变量 | 哪个服务 | 生成方式 |
| --- | --- | --- |
| `CVC_CREDENTIAL_MASTER_KEY` | web | 32 字节 canonical base64：`pnpm tsx scripts/migration/provision-master-key.ts`。**丢失 = 全部 BYOK 凭据不可解密** |
| `CVC_MANAGED_STEPFUN_API_KEY` | web | 现有 StepFun 平台 Key |
| `CVC_MANAGED_MIMO_API_KEY` | web | 现有 MiMo 平台 Key |
| `CVC_MANAGED_GEMINI_API_KEY` | web | 现有 Gemini 平台 Key |
| `PURPLEINK_ENGINE_INTERNAL_KEY` | web + worker（**两端必须完全相同**） | 随机强密钥（如 `openssl rand -base64 32`） |
| `STEP_API_KEY` | worker | 现有 StepFun Key（worker 侧独立，见根 `.env.example` worker 段；worker 读 `STEP_API_KEY`，与 web 侧 `CVC_MANAGED_STEPFUN_API_KEY` 互不代替） |
| `LISTENHUB_API_KEY` | worker | 现有 ListenHub Key |
| `GEMINI_API_KEY` | worker | 现有 Gemini Key（worker 侧独立） |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | web + backup | R2 Token（见 §2.1） |
| `NEXT_PUBLIC_SITE_URL` | web | 生产站点 URL（如 `https://app.shuheng.cloud`） |
| 邮件验证码通道（可选） | web | `CVC_MAIL_SMTP_HOST/PORT/USER/PASS/FROM_*`，见 `.env.example` |
| 体验账号（可选） | web | `CVC_DEMO_ACCOUNT_EMAIL` / `CVC_DEMO_ACCOUNT_PASSWORD`，评审路演用 |

> 部署前可本地跑 `pnpm verify:managed-services` 核对托管服务变量名（只输出变量名与
> configured/missing，不回显值）。

## 3. 服务创建

两条路径任选。推荐 **A（模板导入）**：结构与下面每个服务的配置一一对应，省去逐个
手填；密钥仍然要按 §2.2 在面板补。

### 路径 A：导入 `deploy/zeabur.template.yaml`

1. 控制台 → New Project → **从 YAML 创建模板** → 上传/粘贴 `deploy/zeabur.template.yaml`
2. 填写模板变量（域名；`NEXT_PUBLIC_SITE_URL` 可留空后补）
3. 部署完成后按 §4 补密钥、跑迁移、验收

### 路径 B：面板逐个创建（与模板等价）

创建顺序与要点（服务名必须精确，否则 Dockerfile 不匹配）：

1. **postgresql**：Marketplace 搜 PostgreSQL（官方 `postgres:18`）→ 挂持久卷
   - 记录私网连接：Networking 区块 Private Hostname（形如 `postgresql.zeabur.internal`）、
     `POSTGRES_PORT`（默认 5432）；凭据在 Instruction 标签页
2. **worker**：Git 服务（`scottcwy/PurpleInk`，分支 `zeabur/deploy`），服务名 **`worker`**
   - **不要绑定公网域名**；填 §2.2 的 worker 变量
3. **web**：Git 服务，服务名 **`web`**；绑定域名（网关自动 TLS）
   - 挂卷：路径 **`/app/.data`**（产物本地热缓存 + 重启保留）
   - 填 §2.2 的 web 变量；`BACKEND_ORIGIN` 模板已内置 `http://worker.zeabur.internal:8787`
     （**构建期 ARG**，改它需要重新部署才生效）
4. **migrate**：Git 服务，服务名 **`migrate`**；仅注入 `DATABASE_URL` → 部署一次跑迁移
5. **backup**：Git 服务，服务名 **`backup`**；注入 `DATABASE_URL` + S3 五变量

## 4. 部署后动作（按顺序）

### 4.1 补密钥

按 §2.2 在各服务 Variables 面板填写 secret。web 缺 `CVC_CREDENTIAL_MASTER_KEY` /
托管 Key 会如实报错或功能缺失（`/api/settings` 校验失败返回 422 且不覆盖已有值），
这是设计行为，不是故障。

### 4.2 跑迁移（首次 + 每次发版后）

1. 面板打开 `migrate` 服务 → Redeploy（重新部署）触发 `pnpm db:migrate`
2. 验收：构建日志与运行时日志无错误；**连续触发第二次**，日志必须幂等无变更
3. 迁移完成后容器退出：若平台自动重启（重启循环无害，幂等），在面板 **Suspend**
   暂停该服务，避免空转

### 4.3 验证私网链路

`web` 的 `/api/engine/*` rewrites 指向构建期内联的 `BACKEND_ORIGIN`。部署后浏览器
打开 `https://<域名>/api/engine/health`，应返回 worker 的 `GET /health` 200
（走 web → worker 私网，worker 无公网入口）。

### 4.4 验证备份

1. 查看 `backup` 服务日志：启动约 10s 后首跑，成功输出单行 JSON
   `{"status":"ok","key":"backups/postgres/…","sha256":…}`
2. R2 控制台确认 `purpleink-artifacts` 桶下出现 `backups/postgres/<时间戳>-*.dump`
3. 保留份数默认 14（`PG_BACKUP_RETAIN` 可调）；上传后按 HeadObject 字节数核对
4. **恢复演练是验收项**：从 R2 拉最新备份恢复到全新 PG 实例并通过冒烟
   （`pg_restore -Fc`；未演练过的备份视同不存在）

## 5. 验收清单（评审前逐项打勾）

1. `web` 域名 HTTPS 可达：`/` 200、`/login` 200、`/products` 307
2. `worker` 无公网域名；`/api/engine/health` 经私网 200
3. Chromium 在容器内以非 root 运行且无 `--no-sandbox`；ffmpeg-static 可执行
   （镜像内已按 runbook 验收过的构建方式出包，重建后抽查一次）
4. 迁移连续执行两次幂等
5. 真实渲染一条视频：产物出现在 R2；下载走 302 预签名 URL；`ffprobe` 校验 +
   `content_hash` 与实际字节 SHA-256 一致
6. 重启 `postgresql` 服务后业务数据保留（卷持久化生效）
7. 服务器重建演练：重建后旧产物经 `ensureLocal` 从 R2 回填，渲染链路可继续
8. 备份恢复演练通过（§4.4）
9. 面板确认内存水位：4 GB 上限内 web + worker + PG 并发渲染不 OOM；触顶先降
   队列并发（`CVC_QUEUE_*`）再考虑升配（升级单向，不可降配）

## 6. 已知风险与备选（评审时向对方如实说明）

| 风险 | 现象 | 应对 |
| --- | --- | --- |
| 构建机 2C4G（Free/Dev 档）跑 `pnpm build` 超时/OOM | Next 构建卡死或被杀 | 备选：CI（GitHub Actions）推 GHCR 预构建镜像，Zeabur 用「自定义 Docker 镜像」部署（`ghcr.io/scottcwy/purpleink-*`，compose 已有同款 tag 约定）；或升级 Pro 档 4C8G 构建机 |
| `migrate` 退出后平台重启循环 | 服务反复 Running/Exited | 幂等无害；跑完在面板 Suspend（§4.2） |
| 挂卷服务无法零停机滚动部署 | 更新 web 时短暂断连 | 与既有 runbook 一致：单实例 + recreate 更新，更新前确认队列排空（画布无 running 节点） |
| PG 大版本漂移 | `pg_dump` 版本 < 服务器版本导致备份失败 | `Dockerfile.backup` 按官方模板 postgres:18 对齐客户端；若面板版本不同，改 `postgresql-client-XX` 重构建 |
| `BACKEND_ORIGIN` 是构建期内联 | 改了值要重新部署 web 才生效 | 面板改后 Redeploy web；运行时 `engine-client` 读同一变量，两侧必须一致 |
| Zeabur 平台自动备份 | 仅备份持久卷（PG 数据目录），非 SQL 级 | 作为 R2 pg_dump 的兜底双保险；恢复走面板下载 `data.sql` |

## 7. 后续迭代（CI 接入）预留

- 分支内提交 CI 后，把模板 `source.github.branch` 改到正式分支，或改为
  PREBUILT + GHCR 镜像（`zeabur plan §0` 的备选路径，compose 已按
  `ghcr.io/scottcwy/purpleink-web:${IMAGE_TAG}` 约定）
- Zeabur CLI 支持 token 登录与 `-i=false` 非交互部署，CI 可直接调用
- 发版动作固化：Redeploy `migrate` → Redeploy `web`（`service restart` 或面板）

## 8. 关联文件

| 文件 | 作用 |
| --- | --- |
| `docs/deployment/zeabur-plan.md` | 决策依据与成本 |
| `docs/deployment/runbook.md` | compose 部署的运行手册（镜像验收、卷、凭据轮换） |
| `deploy/zeabur.template.yaml` | Zeabur 服务编排模板（路径 A 输入） |
| `Dockerfile.web` / `.worker` / `.migrate` / `.backup` | 四镜像（服务名自动匹配） |
| `scripts/backup/{schedule,run-backup,pg-backup-r2,rotation}.ts` | 每日备份调度/核心/CLI/轮转 |
