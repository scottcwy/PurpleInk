# 登录体系验收证据（PLAN-002 §8.3）

取证时间：2026-07-26。基线 `yusheng/two-part-merge`。

## 文件

| 文件 | 内容 | 生成方式 |
| --- | --- | --- |
| `login-{desktop,mobile}.png` | `/login` 真实 Chromium 截图 | `node scripts/verify/auth-pages-shot.mjs` |
| `signup-{desktop,mobile}.png` | `/signup` 同上 | 同上 |
| `password-reset-{desktop,mobile}.png` | `/password/reset` 同上 | 同上 |
| `auth-flow-smoke.txt` | 认证链路真实 HTTP 序列 | `node --env-file=.env.local scripts/verify/auth-flow-smoke.mjs` |

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
