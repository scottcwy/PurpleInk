# Zeabur 部署设置与运维

> 操作真值，配合 `docs/deployment/zeabur-plan.md` 使用。只列变量名，值一律走
> Zeabur 服务 Variables 面板；secret 值禁止写入仓库、日志或对话。

## 1. 导入模板

1. 在 Zeabur 项目导入本仓库，选择分支 `zeabur/deploy`；
2. 使用 `deploy/zeabur.template.yaml` 导入服务模板；
3. 模板创建五个服务：postgresql、web、worker、migrate、backup。

## 2. 服务顺序

首次部署按下述顺序确认，迁移在 Web 启动前完成：

1. `postgresql`（PREBUILT `postgres:17.5`）就绪；
2. `migrate` 运行第一次；
3. `migrate` 运行第二次（幂等证明；失败即停，禁止跳过）；
4. `web` 启动（依赖 postgresql 与 worker）；
5. `worker` 启动；
6. `backup` 启动（依赖 postgresql，无暴露端口）。

## 3. Variables 面板（只列变量名）

**Web 面板**：

- `DATABASE_URL`（模板自动注入 `${POSTGRES_CONNECTION_STRING}`）
- `CVC_CREDENTIAL_MASTER_KEY`
- `CVC_REDEMPTION_CODE_PEPPER`
- `CVC_MANAGED_STEPFUN_API_KEY` / `CVC_MANAGED_MIMO_API_KEY` /
  `CVC_MANAGED_GEMINI_API_KEY` / `CVC_MANAGED_OPENAI_API_KEY` /
  `CVC_MANAGED_ANTHROPIC_API_KEY`
- `CVC_MAIL_SMTP_HOST` / `CVC_MAIL_SMTP_PORT` / `CVC_MAIL_SMTP_USER` /
  `CVC_MAIL_SMTP_PASS` / `CVC_MAIL_FROM_ADDRESS` / `CVC_MAIL_FROM_NAME`
- `STORAGE_MODE=s3-mirror`
- Artifact R2：`S3_ENDPOINT` / `S3_BUCKET` / `S3_REGION=auto` /
  `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`
- `PURPLEINK_ENGINE_INTERNAL_KEY`（与 Worker 完全相同的值）
- `NEXT_PUBLIC_SITE_URL`

**Worker 面板**：

- `PURPLEINK_ENGINE_INTERNAL_KEY`（与 Web 相同）
- `PURPLEINK_AI_GATEWAY_ORIGIN`（readonly，`http://web.zeabur.internal:3000`）

**Migrate 面板**：仅 `DATABASE_URL`。

**Backup 面板**：

- `DATABASE_URL`
- `S3_ENDPOINT` / `S3_BUCKET` / `S3_REGION=auto` / `S3_ACCESS_KEY_ID` /
  `S3_SECRET_ACCESS_KEY`
- `PG_BACKUP_PREFIX=backups/postgres/`
- `PG_BACKUP_RETAIN=14`

## 4. R2 token 与轮换

- Artifact bucket token：写、读、删除、`HeadObject`；
- Backup bucket token：写、读、删除、`HeadObject`（与 Artifact bucket 相同的
  最小集合）；
- 轮换顺序：先在 Cloudflare R2 生成新 token → 更新 Web 与 Backup 的
  `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` 并重启对应服务 → 确认备份与
  Artifact 读写正常后删除旧 token。先新后旧，避免窗口期断写。

## 5. 备份监控

- Backup 每次运行输出恒为单行 JSON 日志：成功 `{"status":"ok",...}`，失败
  `{"status":"failed","message":<稳定类别>}`；
- 正常节奏：启动 10s 首跑，成功后每 24h 一次，失败 1h 后重试；
- 告警口径：超过 24h 无成功备份日志即告警；连续 1h 重试仍失败时按稳定类别
  排查（`PG_DUMP_FAILED` / `R2_*`），并核对 R2 token 是否仍有效。

## 6. 保留策略

- `PG_BACKUP_RETAIN` 为正整数，默认 14；
- 对象 key 以 ISO 时间戳开头，字典序即时间序；轮转按 key 排序保留最新 N 份；
- 显式给出 0 / 负数 / 非整数会直接抛错，绝不静默回退默认值。

## 7. 隔离恢复演练

在任何生产恢复决策之前，先在隔离环境跑真实演练：

```bash
pnpm tsx scripts/verify/pg-backup-restore-drill.ts
```

演练启动 disposable 的 PostgreSQL 17.5 源/目标容器与 MinIO，用生成的测试专用
凭据执行一次真实备份 → `pg_restore -Fc` 到目标库 → 核对表与行 → 强制清理。
演练不触碰 Zeabur、R2 或生产凭据。

已记录的实测证据（Task 5，合成本地凭据）：

```json
{"status":"ok","key":"backups/drill-d9a254e8/2026-08-02T20-22-16-879Z-purpleink.dump","users":2,"migrations":1}
```

恢复只允许进入空的、隔离的数据库；生产恢复属于事故响应流程，需另行评审。

## 8. Worker secret 边界

- Worker 无公网入口，只存在于 Zeabur 私有网络
  （`http://worker.zeabur.internal:8787`）；
- Worker 只接收 §3 Worker 面板的变量；它不持有数据库、provider、计费、定价、
  邮件或 R2 凭据；
- Worker 访问 Web 只能走认证 AI 网关（`PURPLEINK_ENGINE_INTERNAL_KEY` +
  `PURPLEINK_AI_GATEWAY_ORIGIN`），网关被拒时不得直连供应商；
- 任何把 `DATABASE_URL`、`S3_*` 或 `CVC_MANAGED_*` 加入 Worker 的改动都违反
  本边界，必须先更新本文与契约测试再谈实现。
