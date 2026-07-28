# 登录体系验收证据（PLAN-002 §8.3）

取证时间：2026-07-26。基线 `yusheng/two-part-merge`。

## 文件

| 文件 | 内容 | 生成方式 |
| --- | --- | --- |
| `login-{desktop,mobile}.png` | `/login` 真实 Chromium 截图 | `node scripts/verify/auth-pages-shot.mjs` |
| `signup-{desktop,mobile}.png` | `/signup` 同上 | 同上 |
| `password-reset-{desktop,mobile}.png` | `/password/reset` 同上 | 同上 |
| `auth-flow-smoke.txt` | 认证链路真实 HTTP 序列 | `node --env-file=.env.local scripts/verify/auth-flow-smoke.mjs` |
| `demo-account-dialog.png` | 登录页体验账号弹窗 | `node scripts/verify/demo-account-dialog-shot.mjs` |

两个脚本都打真实 Next dev server 与真实 Postgres，无 mock、无 fixture。

## 已覆盖

| PLAN-002 §8.3 项 | 状态 | 证据 |
| --- | --- | --- |
| 1 注册全链路 → 进入 dashboard | **部分**：链路通，但邮件未真实投递（见下） | `auth-flow-smoke.txt` |
| 2 验证码 10 分钟过期时间戳对照 | 通过 | 同上，校正后 TTL 599,980ms |
| 3 未登录访问 `/products/dashboard` 302 带 next | 通过 | 307 → `/login?next=%2Fproducts%2Fdashboard` |
| 4 未登录调 `POST /api/director/pipeline` 401 | **未通过** | 实测 409 且泄露 projectId，见下 |
| 5 跨账户产物请求 404 | 未做 | 依赖阶段 B |
| 6 登录后画布 SSE 正常 + keepalive | 未做 | 依赖阶段 B |
| 7 登录页截图 + 控制台无错误 + 海报字节数与 SHA-256 | 通过 | 6 张截图；控制台无 error/warning、无失败请求 |
| 8 速率限制 429 与 `Retry-After` | 未做 | 需要连续压同一邮箱，留待阶段 B 一并取证 |

## 海报优化前后

| | 文件 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| 前 | `public/img/login.png`（2975×4210） | 5,140,649 | `F38011C5F0F931F11D92711953A788D49A290723F55884F17462AFE77E8F9837` |
| 后 | `public/img/login.webp`（1600×2264） | 114,058 | `FC12E25E6CE127A6A287AED8DA64A8A9D94C87E9307DA30D5721BB512CE76C48` |

移动端仍会请求一次，但因容器计算宽度为 0，`sizes` 的 `1px` 分支使其落到最小候选档，
实测 **12,292 B**（`w=384`），不是源文件 114,058 B。桌面 1440×900 DPR1 实测 31,878 B（`w=750`）。

## 版式几何断言（桌面 1440×900）

海报 `x=0`、宽 `720`（=1440/2）、高 `900`（通栏满高），表单不越入左半屏；
移动端 390×844 海报宽度 `0`（折叠）。三页均通过。

## 两个未通过项的说明

### 邮件未真实投递：本机网络问题，非代码问题

`POST /api/auth/signup/code` 实测回 **503「邮件通道当前不可用」**。根因是本机代理以
TUN + fake-ip 模式劫持 DNS：SMTP 主机被解析到 `198.18.0.34`（与 Next dev 打印的
`198.18.0.1` 同段，属 `198.18.0.0/15` benchmarking 段），TCP 能连上但 SMTP 握手失败，
nodemailer 报 `{ code: 'ESOCKET', command: 'CONN' }`。

要补齐 §8.3 第 1 项的「真实收到邮件」证据，需要先给 SMTP 主机配置代理直连规则，
并使用真实可收信邮箱。**当前不得声称邮件通道已验证。**

顺带修掉的缺陷：此前发信失败一律回 200「验证码已发送」，用户会一直等一封永远不来的
邮件。已按泄露性质分级（`src/features/auth/mail-failure.ts`）：通道级失败回 503，
收件人级拒收仍回 200。

### `POST /api/director/pipeline` 未登录回 409 而非 401

13 条既有 API 尚未接会话守卫（PLAN-002 §3.3，属阶段 B）。当前行为有两个问题：

1. 未登录可直接调用，只是因为 `projectId` 不属于任何已知项目才失败；
2. 错误文案里**回显了内部 projectId**，违反 AGENTS.md §6 与 `routing.md` §9.2
   的「归属错误一律 404、不泄露对象是否存在」。

阶段 B 收口时必须同时修掉这两点，并重新留证。

## 路演补充：体验账号与零填写 API Key

### 体验账号弹窗

> **2026-07-28 更新**：登录页的体验账号提示弹窗已整体移除（`demo-account.ts`、
> `demo-account-dialog.tsx` 与 `demo-account-dialog-shot.mjs` 已删除，
> `CVC_DEMO_ACCOUNT_*` 不再下发到浏览器）。下方段落与 `demo-account-dialog.png`
> 保留为历史取证记录；建号机制（`seed-owner-account.ts` 与 compose 的
> `seed-demo-account` 服务）不变。

`/login` 在 `CVC_DEMO_ACCOUNT_EMAIL` 与 `CVC_DEMO_ACCOUNT_PASSWORD` **同时非空**时，
自动弹出体验账号提示，提供「填入并登录」。默认关闭，不设这两个变量即彻底不出现。

刻意**不用 `NEXT_PUBLIC_*`**：那会在构建期把凭据内联进客户端 bundle，之后无法用
环境变量关掉，也无法在不重新构建的情况下换账号。改为在 Server Component 里读普通
env 再作为 props 下传——值仍会到浏览器（本来就是要给评委看的），但开关与内容在
运行期可控。

实测（`node scripts/verify/demo-account-dialog-shot.mjs`）：弹窗自动出现且带
`aria-modal`；「填入并登录」直达 `/products/dashboard`；「我自己输入」关闭后表单为空、
不留预填；「查看体验账号」可重新打开；控制台无 error/warning。

账号本身由 `pnpm tsx scripts/setup/seed-owner-account.ts` 创建，绑 `LOCAL_WORKSPACE_ID`，
因此登录后看到的是真实入库的项目与产物，不是示例数据。

### 评委无需填写 API Key 的实现路径

**核实到的现状**：Next 侧 AI 凭据是 DB-only —— `provider_credentials` 加密表，
`getStepfunConfig()` / `getGeminiConfig()` 只读 `loadSecret()`，**没有 env fallback**，
且被 `config.test.ts:119` 与 `gemini-config.test.ts:93` 两个契约测试双向锁死
（后者显式断言 DB 值胜过 env 值）。运行镜像里也不含 `src/` 与 `scripts/`。

因此「env 里放 Key」不能靠运行时读取，必须在启动前把 env 的明文 Key 转成加密存储。
原 `docker-compose.prod.yml` **没有这一步**，`next` 服务也不注入任何 provider key，
结果是终端用户必须自己在设置页填 Key 才能跑 AI。

补齐方式（两个一次性任务，都用 `migrate` target 镜像，因为它含 `tsx` 与源码）：

| 服务 | 入口 | 作用 |
| --- | --- | --- |
| `bootstrap-credentials` | `scripts/setup/bootstrap-credentials.ts --allow-empty` | env 明文 Key → 真实 API 校验 → 写入加密存储 |
| `seed-demo-account` | `scripts/setup/seed-owner-account.ts --from-env` | 建体验账号；未设 demo env 时原地退出 0，什么都不做 |

`next.depends_on` 都加了 `service_completed_successfully`，因此容器起来时凭据已就位。

两条防误伤设计：

- `--allow-empty`：没提供 Key 时如实提示并退出 0，**不阻断整栈启动** —— 应用没有
  凭据也能正常起（凭据只在跑管线时才需要，见 ISSUE-015:203）。但 Key 校验失败仍
  退出 1，配置错了必须响。
- `STEPFUN_API_KEY: ${STEPFUN_API_KEY:-${STEP_API_KEY:-}}`：worker 用 `STEP_API_KEY`、
  Next 用 `STEPFUN_API_KEY` 是有意的命名隔离，这里让后者默认复用前者的值，
  避免运维为同一把 Key 填两遍。实测 `docker compose config` 确认嵌套默认值生效。

模型名与 provider 路由**不需要预置**：`model_routes` 空表时 `model-routing.ts:30-40`
的 `DEFAULT_PROVIDER` 与 `config.ts` / `gemini-config.ts` 的 `DEFAULTS` 提供代码默认值。
唯一必须预置的就是 `provider_credentials` 里的 apiKey。

### bootstrap 脚本的三条分支实测

| 分支 | 命令 | 结果 |
| --- | --- | --- |
| 有 Key | `pnpm tsx scripts/setup/bootstrap-credentials.ts --allow-empty` | `written=2 skipped=0 failed=0`，exit 0；`provider_credentials` 出现 gemini / stepfun 两行且 `verified_at` 非空；`GET /api/settings` 回 `configured=true` 与 `geminiConfigured=true` |
| 无 Key + `--allow-empty` | 同上，env 置空 | 如实提示后 exit **0**，不阻断启动 |
| 无 Key 不带 flag | 去掉 flag | exit **2**（保持既有本地契约） |
| 体验账号 `--from-env` 未设变量 | `seed-owner-account.ts --from-env` | 原地提示后 exit 0，不建号 |

期间修掉一个**会阻断生产启动**的缺陷：`bootstrap-credentials.ts` 打印完结果后
不退出（`getDb()` 的连接锚在 globalThis 上，脚本侧没有关闭出口），实测挂住 300s
未结束。在 compose 里这意味着 `service_completed_successfully` 永远不触发、`next`
永远起不来。已补显式 `process.exit(process.exitCode ?? 0)`，失败路径同样改为
`process.exit(1)`。

同时修掉 `seed-owner-account.ts` 的 env 加载顺序：`--from-env` 原先在
`loadEnvConfig()` **之前**读 `process.env`，容器里（env 直接注入）能工作但本地
（值来自 `.env.local`）会误判为「未设置」。已把 `loadEnvConfig()` 提到解析参数之前。

未做（明确记录，不当作已验证）：**生产 compose 栈未实跑**。上表是在本地宿主直接
跑脚本得到的，`docker compose config` 只验证了编排解析与嵌套默认值。真实生产栈里
`bootstrap-credentials` 容器需要能出网（脚本会真实调用 stepfun / gemini 校验 Key），
首次部署必须盯这一步的容器日志。
