# 接入策略与边界防护（P-2）

- 对应：`docs/issues/ISSUE-015-production-issue.md` §2.1 / §9 P-2、
  `docs/plans/PLAN-001-p2-p6-p7-production-deployment.md` §1
- 范围：部署层（反代 + compose network），**不改 `src/**`**
- 与 `PLAN-002-auth-system.md` 的关系：本项只做部署层边界防护，不实现应用内认证；
  应用内认证落地后按 §5 降级本项配置

## 1. 决策结论

**组合方案**：网络层 IP 过滤（默认放行，生产收紧）+ 反代 Basic Auth over TLS
（Caddy）。

理由：

- 客户端画布状态订阅用同源 `EventSource`（`use-project-status-stream.ts`、
  `use-stage-stream.ts`），它**不能设置自定义请求头**——任何要求
  `Authorization: Bearer <token>` 头的方案都会打断 SSE，因此排除 header token
  与需要签发端的 Cookie 会话方案（后者等于在部署层做半个认证系统，违反 P-2 禁区）。
- Basic Auth 走浏览器原生凭据缓存，同源请求（含 `EventSource`）会自动带上，
  对前端代码零侵入。
- 反代选 **Caddy**：内置自动 TLS（`tls internal` 本地自签证书 / 真实域名自动
  ACME），配置比 nginx 简洁，`basic_auth` 指令与 IP 匹配器（`remote_ip`）能力足够。

## 2. 拓扑

```text
公网/内网 ──► reverse-proxy (Caddy，唯一 publish：443)
                │ TLS 终止 + IP 过滤 + Basic Auth + 默认拒绝（无路径白名单）
                ▼
              next (3000，不 publish，仅内部 network)
                │ BACKEND_ORIGIN（内网）
                ▼
              worker (8787，不 publish)
              postgres（不 publish，独立持久卷）
```

关键点（与 PLAN-001 §1.3 一致）：

1. `next` 容器不写 `ports:`，反代是唯一 publish 的服务。
2. `postgres` 不映射任何宿主端口。
3. `worker` 若部署也不 publish，只经 `BACKEND_ORIGIN` 被 `next` 的
   `next.config.ts` rewrites 在容器内网访问。
4. 健康检查走内网直连各自容器（`next` 用 `GET /api/ping`，`worker` 用
   `GET /health`），**反代上不为健康检查开豁免路径**——开了就是一个永久的未认证
   入口。这一条已在 `docker-compose.prod.yml` 里落实：healthcheck 用容器内
   `node -e "fetch(...)"` 直连各自容器的内部端口（镜像不含 `curl`），不经过
   Caddy。

## 3. 反代做对的四件事

落点：`deploy/reverse-proxy/Caddyfile`。

1. **默认拒绝，不做路径白名单**：`:443` 是唯一 catch-all 块，`basic_auth` 与
   `remote_ip` 过滤应用在块级别，覆盖 `/`、`/products/*`、`/playbook/*`、
   `/api/*`、`/api/engine/*` 全部路径。将来按 `routing.md` 新增路由无需同步改
   反代配置。
2. **放行 SSE**：`flush_interval -1` 关闭反代侧缓冲；**不启用 gzip/encode**——
   `text/event-stream` 若被压缩会破坏分块流，等价于 nginx 侧把它排除在
   `gzip_types` 之外，这里选择直接不开 `encode` 指令，避免遗漏。应用侧已经
   设对 `Cache-Control: no-cache, no-transform` 与 `X-Accel-Buffering: no`
   （两条流式路由：`src/app/api/director/stream/[nodeId]/route.ts`、
   `src/app/api/director/stream/project/[projectId]/route.ts`），`KEEPALIVE_MS`
   都是 15000，反代必须能扛住空闲 >15s 不断流。
3. **容得下慢请求**：Caddy 默认无 read timeout 限制，`POST /api/settings` 的
   真实 provider 校验往返与产物下载（几十 MB MP4）不会被反代提前掐断。
4. **TLS 必须有**：`tls internal` 用 Caddy 内置 CA 签发自签证书，足够本地/内网
   验证；有真实域名时把 `:443` 换成域名块以启用自动 Let's Encrypt（见 §5）。

## 4. 网络层过滤

`Caddyfile` 里的 `@blocked not remote_ip {$CVC_ALLOWED_CIDRS}` 是第一道防线。

- 默认值 `0.0.0.0/0 ::/0`（放行所有网段）由 `entrypoint.sh` 兜底，**不设置
  等价于不设防**，本地/内网验证阶段可以接受。
- **生产必须收紧**：在 `docker-compose.prod.yml` 的 `reverse-proxy.environment`
  里把 `CVC_ALLOWED_CIDRS` 改成真实 VPN 出口网段 / 办公网 CIDR，多个网段用空格
  分隔（Caddy `remote_ip` 匹配器语法）。
- 共享出口 IP（如公司统一 NAT）场景下这道形同虚设，必须依赖第二道 Basic Auth。

### 4.1 两道防线的实测状态码

Caddy 的指令排序把 `basic_auth` 排在 `respond` 之前，所以**网段外的匿名请求先拿
401 而不是 403**。判断 IP 过滤是否真的生效，必须带上正确凭据再请求。单独起
reverse-proxy 容器（`CVC_ALLOWED_CIDRS` 设成一个不含客户端的网段）实测：

| 客户端 IP | 凭据 | 状态码 | 含义 |
| --- | --- | --- | --- |
| 网段内 | 无 / 错 | 401 | Basic Auth 拦下 |
| 网段内 | 正确 | 转发到上游 | 两道都过（上游缺失时是 502） |
| 网段外 | 无 | 401 | 看不出 IP 是否被拦，属正常现象 |
| 网段外 | 正确 | 403 | IP 过滤生效的唯一判据 |

缺 `/run/secrets/basic_auth_credentials` 时 `entrypoint.sh` 直接退出，不会以无认证
状态起来——这一条也实测过。

## 5. TLS 与凭据生成

### 5.1 本地 / 内网验证（自签证书）

`Caddyfile` 默认 `tls internal`，容器首次启动会自动生成并信任内部 CA。
浏览器/curl 访问会报证书不受信任，需要：

- curl 加 `-k`（仅验证阶段用，见 §7 的验证证据里如实标注）；
- 或按 Caddy 文档导出内部根证书装进系统信任库（生产不建议长期这样用）。

### 5.2 生产（真实域名，自动 ACME）

把 `Caddyfile` 的 `:443 { tls internal ... }` 改成：

```caddyfile
your-domain.example.com {
	# 其余指令不变
}
```

Caddy 会自动向 Let's Encrypt 申请并续期证书，前提是 80/443 均可从公网访问且
DNS 已指向该主机。

### 5.3 Basic Auth 凭据

```powershell
docker run --rm caddy:2.10-alpine caddy hash-password --plaintext '你的口令'
```

把输出的 bcrypt 哈希与用户名拼成单行 `"<用户名> <哈希>"`，写入
`deploy/reverse-proxy/secrets/basic_auth_credentials`（已加入 `.gitignore`，
不提交仓库；参考同目录 `basic_auth_credentials.example` 的格式）。该文件由
`docker-compose.prod.yml` 通过 `secrets:` 挂载到反代容器的
`/run/secrets/basic_auth_credentials`，`entrypoint.sh` 在启动时读取并注入
`CVC_BASIC_AUTH_USER` / `CVC_BASIC_AUTH_HASH` 两个环境变量给 Caddy 进程——
**口令不进镜像层、不写进 compose 明文、不提交仓库**。

轮换：替换该文件内容后 `docker compose restart reverse-proxy` 即可，不需要
重建镜像。

## 6. 取证脚本的凭据入口

`scripts/verify/e2e-smoke.ts` 新增只读 env 入口 `CVC_VERIFY_BASIC_AUTH`
（格式 `user:pass`），在 `post()` / `get()` 统一注入
`Authorization: Basic <base64>`。未设置时行为与之前完全一致（不发头），
本地无反代场景仍可直接用。这个入口后续会被 `PLAN-002` 的登录复用（改成携带
会话 cookie），只做一个出口，不在两处各写一份注入逻辑。

`.env.example` 已追加同名变量（值留空，见根目录 `.env.example`）。

## 7. 验收与证据

证据落 `docs/issues/evidence/issue-015/p2/`：

1. **未携带凭据被拒**：`POST /api/settings`、`POST /api/director/pipeline`、
   `GET /api/artifacts/{id}?projectId=`、`GET /api/projects` 四条，各留完整
   响应（状态码 + 响应头 + body）。
2. **证明请求没到达 next**：同一时间窗内反代日志（`docker compose logs
   reverse-proxy`）有记录、`next` 容器日志（`docker compose logs next`）
   **无**对应请求。
3. **携带凭据后 SSE 正常**：`GET /api/director/stream/project/{projectId}`
   收到 `node-status` 帧；空闲超过 15s 后仍能收到 `: keepalive`。
4. **Postgres 不可从宿主直连**：宿主对生产 Postgres 端口的连接被拒绝
   （`docker-compose.prod.yml` 未映射该端口，`Test-NetConnection` 应超时/拒绝）。

## 8. 禁区

1. 不在本项实现应用内认证（会牵动 `routing.md` §9 守卫矩阵与
   `LOCAL_WORKSPACE_ID` 单工作区模型，必须单开 issue → 见 `PLAN-002`）。
2. 不用 header token 方案（打断 `EventSource`）。
3. 不在反代上为健康检查、监控或 webhook 开豁免路径。
4. 不把 `routing.md` §9.2「404 掩盖归属错误」的口径套到反代层——反代在应用
   之前，谈不上归属，返 401/403 是正确的。

## 9. 与 PLAN-002 的衔接

登录体系落地后，把反代从 Basic Auth **降级为纯网络层**（保留 `remote_ip`
过滤，去掉 `basic_auth` 块），纵深防御保留、UX 上不再双重输入。该降级只改
`Caddyfile`，不动 `src/**`。
