# ISSUE-015 P-2 验收证据

- 环境：本地 Docker Desktop，`docker-compose.prod.yml` 全量拉起
  （`reverse-proxy` + `next` + `postgres` + `worker`，`migrate` 一次性任务）
- 反代：`deploy/reverse-proxy/Caddyfile`，Basic Auth 用户 `verifyuser`
  （仅本地验证用测试口令，非生产凭据）
- 测试客户端：容器内 `curlimages/curl`（同一 compose network），规避 Windows
  curl(schannel) 对自签证书的已知兼容性问题

## 1. 未携带凭据被反代拒绝（PLAN-001 §1.7 第 1 条）

```text
$ docker run --rm --network purpleink-dev_default curlimages/curl \
    -sk -o /dev/null -w "unauth ping=%{http_code}\n" \
    https://reverse-proxy:443/api/ping
unauth ping=401

$ docker run --rm --network purpleink-dev_default curlimages/curl \
    -sk -o /dev/null -w "unauth POST /api/settings=%{http_code}\n" \
    -X POST https://reverse-proxy:443/api/settings
unauth POST /api/settings=401

$ docker run --rm --network purpleink-dev_default curlimages/curl \
    -sk -o /dev/null -w "unauth POST /api/director/pipeline=%{http_code}\n" \
    -X POST https://reverse-proxy:443/api/director/pipeline
unauth POST /api/director/pipeline=401

$ docker run --rm --network purpleink-dev_default curlimages/curl \
    -sk -o /dev/null -w "unauth GET /api/artifacts=%{http_code}\n" \
    "https://reverse-proxy:443/api/artifacts/00000000-0000-0000-0000-000000000000?projectId=x"
unauth GET /api/artifacts=401
```

四条全部 401，响应头带 `Www-Authenticate: Basic realm="restricted"`（见 §2 原始
access log）。

## 2. 证明请求没到达 Next（PLAN-001 §1.7 第 2 条，核心证据）

反代 access log（`docker logs purpleink-dev-reverse-proxy-1`）里能看到这四条
请求的完整记录，`status: 401`，且**从未进入** `reverse_proxy` upstream 转发
（Caddy 在 `basic_auth` 阶段短路，不会有 `next:3000` 侧的对应日志）：

```json
{"logger":"http.log.access.log0","msg":"handled request","request":{"remote_ip":"172.19.0.6","method":"GET","host":"reverse-proxy","uri":"/api/ping","headers":{"User-Agent":["curl/8.21.0"],"Accept":["*/*"]}},"status":401,"resp_headers":{"Www-Authenticate":["Basic realm=\"restricted\""]}}
{"logger":"http.log.access.log0","msg":"handled request","request":{"method":"POST","uri":"/api/settings"},"status":401,"resp_headers":{"Www-Authenticate":["Basic realm=\"restricted\""]}}
{"logger":"http.log.access.log0","msg":"handled request","request":{"method":"POST","uri":"/api/director/pipeline"},"status":401,"resp_headers":{"Www-Authenticate":["Basic realm=\"restricted\""]}}
{"logger":"http.log.access.log0","msg":"handled request","request":{"method":"GET","uri":"/api/artifacts/00000000-0000-0000-0000-000000000000?projectId=x"},"status":401,"resp_headers":{"Www-Authenticate":["Basic realm=\"restricted\""]}}
```

同一时间窗内 `docker logs purpleink-dev-next-1` 对 `settings` / `pipeline` /
`artifacts` 三个关键字**零命中**（已用
`Select-String "settings|pipeline|artifacts"` 核对，无输出）。

## 3. 携带凭据后请求正常到达 Next（对照组）

```text
$ docker run --rm --network purpleink-dev_default curlimages/curl \
    -sk -o /dev/null -w "AUTH ping=%{http_code}\n" \
    -u "verifyuser:local-verify-only" https://reverse-proxy:443/api/ping
AUTH ping=200
```

对应反代日志：

```json
{"logger":"http.log.access.log0","msg":"handled request","request":{"method":"GET","uri":"/api/ping","headers":{"Authorization":["REDACTED"]}},"user_id":"verifyuser","duration":0.766089756,"size":37,"status":200,"resp_headers":{"Vary":["rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch"],"Content-Type":["application/json"],"Via":["1.1 Caddy"]}}
```

`Vary: rsc, next-router-state-tree, ...` 与 `Via: 1.1 Caddy` 表明响应确实由
`next:3000` 生成、经反代转发回来，而不是反代自己应答的。

## 4. 携带凭据后 SSE 正常，空闲 >15s 仍收到 keepalive（PLAN-001 §1.7 第 3 条）

先建一个真实项目（`POST /api/projects`，body `{"title":"deploy-verify"}`）拿到
`projectId=98aab1b7-017b-445f-b814-3c05793d8d07`，再订阅项目级状态流：

```text
$ docker run --rm --network purpleink-dev_default curlimages/curl \
    -sk -N --max-time 20 -u "verifyuser:local-verify-only" \
    "https://reverse-proxy:443/api/director/stream/project/98aab1b7-017b-445f-b814-3c05793d8d07"

event: snapshot
data: {"seq":0,"statuses":{}}

: keepalive

```

`snapshot` 事件立即到达（证明反代未缓冲首包），且连接维持超过
`KEEPALIVE_MS=15_000` 后收到 `: keepalive` 注释帧（证明反代
`flush_interval -1` + 未启用 gzip 对 SSE 生效，长连接未被提前断流）。
`curl --max-time 20` 到时退出属预期（人为截断测试时长，不是连接被断）。

## 5. Postgres 不可从宿主直连（PLAN-001 §1.7 第 4 条）

```text
$ Test-NetConnection -ComputerName 127.0.0.1 -Port 5432 -InformationLevel Detailed
ComputerName    : 127.0.0.1
RemotePort      : 5432
TcpTestSucceeded : False
```

`docker-compose.prod.yml` 的 `postgres` 服务未写 `ports:`，仅容器间内网可达；
`docker compose ps` 也确认 `postgres` 一栏只显示 `5432/tcp`（无宿主映射）。

## 6. 拓扑核对（`docker compose ps`）

```text
NAME                            PORTS
purpleink-dev-next-1            3000/tcp
purpleink-dev-postgres-1        5432/tcp
purpleink-dev-reverse-proxy-1   0.0.0.0:443->443/tcp, [::]:443->443/tcp
purpleink-dev-worker-1          8787/tcp
```

只有 `reverse-proxy` 发布端口，与 PLAN-001 §1.3 目标拓扑一致。
