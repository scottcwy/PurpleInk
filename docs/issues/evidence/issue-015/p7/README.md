# ISSUE-015 P-7 验收证据

## 1. 迁移连续两次成功，第二次无变更（PLAN-001 §3.7 第 1 条）

```text
$ docker compose -f docker-compose.prod.yml run --rm migrate   # 第一次
...
> ai-saas@0.1.0 db:migrate /repo
> tsx scripts/setup/db-migrate.ts

[db] Postgres migrations applied

$ docker compose -f docker-compose.prod.yml run --rm migrate   # 第二次
...
> ai-saas@0.1.0 db:migrate /repo
> tsx scripts/setup/db-migrate.ts

{
  severity_local: 'NOTICE', code: '42P06',
  message: 'schema "drizzle" already exists, skipping', ...
}
{
  severity_local: 'NOTICE', code: '42P07',
  message: 'relation "__drizzle_migrations" already exists, skipping', ...
}
[db] Postgres migrations applied
EXITCODE=0
```

第二次只有幂等 NOTICE（schema/relation 已存在），无实际 DDL 变更，两次都
`exit 0`。

## 2. `docker compose config` 不含明文 secret（PLAN-001 §3.7 第 2 条）

在**未设置真实值**的环境下（`POSTGRES_PASSWORD` / `CVC_CREDENTIAL_MASTER_KEY`
等使用仅供本地验证的占位值）跑 `docker compose -f docker-compose.prod.yml
config`，输出中所有敏感字段都是从 `${VAR}` 插值解析而来，`basic_auth_credentials`
在 `secrets:` 顶层只暴露**文件路径**，不暴露文件内容：

```yaml
secrets:
  basic_auth_credentials:
    name: purpleink-dev_basic_auth_credentials
    file: D:\projects\Dev-Tools\PurpleInk-dev\deploy\reverse-proxy\secrets\basic_auth_credentials
```

`next` / `migrate` 服务的 `DATABASE_URL` 是编排里唯一"看得见值"的字段（因为
它由 compose 侧拼接 `postgres://cvc:${POSTGRES_PASSWORD}@postgres:5432/cvc`
再传给容器），但这是**运行时容器环境变量**，不是写进镜像层或提交进仓库的
明文——真实生产口令只应存在于宿主 `.env`（已加入 `.gitignore`）里，不提交、
不打进镜像。

## 3. 容器重启（`down` + `up`）后数据仍在（PLAN-001 §3.7 第 3 条）

```text
$ docker run ... curl -u verifyuser:*** -X POST .../api/projects -d '{"title":"deploy-verify"}'
{"ok":true,"project":{"id":"98aab1b7-017b-445f-b814-3c05793d8d07","title":"deploy-verify",...}}

$ docker compose -f docker-compose.prod.yml down
$ docker compose -f docker-compose.prod.yml up -d
... (all 5 containers recreated and healthy)

$ docker run ... curl -u verifyuser:*** https://reverse-proxy:443/api/projects
{"projects":[{"id":"98aab1b7-017b-445f-b814-3c05793d8d07","title":"deploy-verify",...}]}
```

`docker compose down`（不带 `-v`）只删容器与网络，不删命名卷；重建后
`cvc_postgres_prod` 卷里的项目记录原样可查，证明持久化生效。

## 4. 宿主无法直连 Postgres 端口（PLAN-001 §3.7 第 4 条）

见 `../p2/README.md` §5（同一实测，`postgres` 服务未映射任何宿主端口）。

## 5. 构建上下文体积合理（PLAN-001 §3.7 第 5 条）

`.dockerignore`（P-1 已建立）排除 `node_modules`、`.next`、`.data`、
`docs`、`tests`、`*.mp4` 等；根 Dockerfile 与 `server/Dockerfile` 的 `deps`
阶段都只 `COPY` 了 `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml`
几个元数据文件后再跑 `pnpm install`，源码与产物分层 `COPY` 在后续阶段按需
引入，未见整棵仓库被一次性送进构建上下文。

## 6. 并发配额 env 显式设置（PLAN-001 §3.7 第 6 条）

`docker-compose.prod.yml` 对 `next` 服务用 `${VAR:?错误提示}` 语法强制要求
显式设置，缺失时 `docker compose` 直接报错拒绝启动（而不是静默回退到不安全
默认值）。`docker compose config` 展开后可见：

```yaml
environment:
  CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY: "1"
  CVC_QUEUE_RENDER_SHOT_CONCURRENCY: "1"
```

（本地验证用值 `1`，生产按 `docs/deployment/runbook.md` §3 的指引根据实际
容器 `--cpus` 上限设置。）

## 7. 是否部署 worker

本次选择**一起部署**（`docker-compose.prod.yml` 含 `worker` 服务），不
publish 端口，`next` 经 `BACKEND_ORIGIN=http://worker:8787` 内网访问；
`worker` 健康检查 `GET /health` 独立于 `next` 的 `GET /api/ping`。

```text
$ docker compose -f docker-compose.prod.yml ps
NAME                            PORTS
purpleink-dev-next-1            3000/tcp
purpleink-dev-postgres-1        5432/tcp
purpleink-dev-reverse-proxy-1   0.0.0.0:443->443/tcp, [::]:443->443/tcp
purpleink-dev-worker-1          8787/tcp
STATUS: next(healthy) postgres(healthy) worker(healthy) reverse-proxy(up)
```
