# Zeabur 生产部署架构决策（Active Truth）

> 本文是 PurpleInk 生产部署的**现行唯一真值**，配合
> `docs/deployment/zeabur-setup.md` 使用。历史部署文档只供追溯，不构成现行
> 实现（见 `docs/integration/predev-2026-08-01.md` 与
> `docs/plans/PLAN-001-p2-p6-p7-production-deployment.md` 的历史横幅）。

## 1. 核心决策

1. **Zeabur Git 构建是唯一生产部署路径。** 生产服务全部由
   `deploy/zeabur.template.yaml` 导入，应用服务从 `zeabur/deploy` 分支按 Git
   源构建。生产不发布 registry 镜像、不部署预构建镜像 tag、不自建反向代理、
   不使用本地多容器编排栈。
2. **PostgreSQL 17.5 是结构化数据真值。** 业务、队列、账本、迁移与全部结构化
   状态的唯一来源是 Zeabur PostgreSQL（`postgres:17.5`，PREBUILT 服务）。
   R2 不替代 PostgreSQL。
3. **R2 是持久字节层。** Artifact 字节（`STORAGE_MODE=s3-mirror`）与 PostgreSQL
   备份归档（Backup 服务）都持久化到 Cloudflare R2；本地文件系统只作热缓存与
   暂存层。
4. **四个镜像统一 Node 22。** Web / Worker / Migrate / Backup 全部使用
   `node:22-bookworm-slim` 与 pnpm 10.30.0。
5. **迁移执行两次。** Migrate 服务连续运行两次验证幂等，与 CI 的迁移门禁对齐；
   迁移只向前，禁用 down migration，失败迁移不得跳过。

## 2. 服务拓扑与私有网络边界

Zeabur 私有服务地址：

- Web：`http://web.zeabur.internal:3000`
- Worker：`http://worker.zeabur.internal:8787`

| 服务 | 构建方式 | 职责 | 环境边界 |
| --- | --- | --- | --- |
| postgresql | PREBUILT `postgres:17.5` | 结构化数据真值 | 模板内置变量 |
| web | GIT `zeabur/deploy` | 应用本体：数据库、provider、计费、邮件、服务间密钥、Artifact R2 | §3 Web 清单 |
| worker | GIT `zeabur/deploy` | 采集、媒体处理、渲染 | §3 Worker 清单（仅渲染契约） |
| migrate | GIT `zeabur/deploy` | 迁移（连续执行两次） | 仅 `DATABASE_URL` |
| backup | GIT `zeabur/deploy` | 每日 pg_dump → R2 归档 | §3 Backup 清单 |

边界事实：

- `web.zeabur.internal` / `worker.zeabur.internal` 只在 Zeabur 私有网络内可达；
  不存在公网直连反代，不存在反代层认证或 IP 白名单。
- Worker 不依赖 postgresql，不持有数据库、provider、计费、定价或 R2 凭据；
  它只经 Web 的认证 AI 网关通信（`PURPLEINK_AI_GATEWAY_ORIGIN` 指向
  `http://web.zeabur.internal:3000`）。
- Backup 无暴露端口、无卷、无 Worker 依赖，只依赖 postgresql。

## 3. 环境变量边界（只列变量名，值一律走 Zeabur Variables 面板）

**Web**：
`DATABASE_URL`（模板自动注入）、`CVC_CREDENTIAL_MASTER_KEY`、
`CVC_REDEMPTION_CODE_PEPPER`、`CVC_MANAGED_*`（五家托管供应商）、
`CVC_MAIL_*`（出站验证码邮件）、`STORAGE_MODE=s3-mirror`、
`S3_ENDPOINT` / `S3_BUCKET` / `S3_REGION` / `S3_ACCESS_KEY_ID` /
`S3_SECRET_ACCESS_KEY`（Artifact R2）、`PURPLEINK_ENGINE_INTERNAL_KEY`、
`NEXT_PUBLIC_SITE_URL`。

**Worker（仅这些）**：
`PURPLEINK_ENGINE_INTERNAL_KEY`、`PURPLEINK_AI_GATEWAY_ORIGIN`（只读）、
`BROWSER_DRIVER`、`PURPLEINK_COMPOSE_MODE`、`PURPLEINK_FFMPEG_DIR`、`PORT`。

**Migrate**：`DATABASE_URL`。

**Backup**：
`DATABASE_URL`、`S3_ENDPOINT` / `S3_BUCKET` / `S3_REGION` /
`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`、`PG_BACKUP_PREFIX`、
`PG_BACKUP_RETAIN`。

Web 与 Backup 共享同一组 S3 兼容变量形态（可分别签发 Artifact 与 Backup 两个
bucket 的独立 token）；Worker 永不接收数据库或 S3 变量。详见
`docs/deployment/zeabur-setup.md` §3–§4。

## 4. Artifact 字节持久化（s3-mirror + hash-gated 302）

- `STORAGE_MODE=s3-mirror`：本地 `DATA_DIR/artifacts` 只作热缓存，持久层是 R2。
- 写入：按实际字节计算 SHA-256，作为 `content-sha256` 对象元数据随上传一并
  写入；字节与哈希来自同一份内容，禁止伪造。
- 读取：受保护成片（final-mp4 / website-video-mp4）必须先做远端 metadata
  HEAD，`content-sha256` 与登记哈希一致后才允许签名 302；不暴露未验证的直接
  对象 URL。本地模式回退为既有字节流并做实际字节哈希校验。
- 缓存进程重启后先怀疑缓存：远端校验不过即隔离/失效本地副本，不允许陈旧本地
  副本冒充持久真值。

## 5. PostgreSQL 备份管线（Backup 服务）

每日调度，pipeline 顺序固定：

1. 创建唯一临时目录（`mkdtemp`）；
2. `pg_dump --format=custom`（-Fc）写入该目录；
3. 拒绝空 dump（0 字节直接失败）；
4. 按实际字节计算 SHA-256；
5. PutObject 上传 R2（key 前缀 `PG_BACKUP_PREFIX`，默认 `backups/postgres/`）；
6. HeadObject 核对远端 `ContentLength` 与实际字节数一致；不一致立即中止，
   **不进入轮转**；
7. 列表并按保留份数轮转删除超出 `PG_BACKUP_RETAIN` 的旧备份；
8. `finally` 删除临时目录。

失败只暴露稳定类别，连接串 / 密钥值 / 原始 stderr 一律不回显：

`PG_DUMP_FAILED` / `PG_DUMP_EMPTY` / `R2_UPLOAD_FAILED` / `R2_VERIFY_FAILED` /
`R2_LIST_FAILED` / `R2_ROTATE_FAILED` / `BACKUP_TEMP_FAILED`

`PG_BACKUP_RETAIN` 必须是正整数，缺省 14；显式给出非正整数直接抛错，绝不静默
回退。调度：启动 10s 首跑，成功后每 24h 一次，失败 1h 后重试；每次运行输出
单行 JSON（成功 `status:"ok"` / 失败 `status:"failed"` + 稳定类别）。

## 6. 恢复策略

- 恢复只允许进入**空的、隔离的**数据库；任何生产恢复决策之前先做演练。
- 演练：`pnpm tsx scripts/verify/pg-backup-restore-drill.ts`（disposable
  PostgreSQL 17.5 源/目标 + MinIO，生成测试专用凭据）。
- 已记录的演练证据见 `docs/integration/zeabur-predev-integration-2026-08-02.md`
  §4（Task 5 drill ok JSON）。
