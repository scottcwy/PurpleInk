# PLAN-002 · 登录体系实施指南（面向执行 AI）

- 计划性质：新增应用内身份认证 + 账户数据归属改造
- 撰写日期：2026-07-26
- 审查基线：`yusheng/two-part-merge`
- 上游真值：`AGENTS.md`、`docs/conventions/routing.md`（§9 守卫矩阵）、
  `docs/designs/canvas.pen`、`docs/designs/Design-system-inventory.md`、`/playbook`
- 并行计划：`PLAN-001-p2-p6-p7-production-deployment.md`（部署边界）
- 后续影响：`docs/issues/ISSUE-015-production-issue.md` 的 P-2 / P-4 / P-5 / P-7 / P-8 / P-9
  在本计划落地后需要复核或再次修复，逐条见 §9

## 0. 读前必读

### 0.1 这份计划要解决什么

仓库目前**没有任何认证**。`routing.md` §9.1 已显式记录这一点：既无 `proxy.ts` 也无
`middleware.ts`，全部页面与全部 `/api/*` 都不读 cookie / session，workspace 固定为
`LOCAL_WORKSPACE_ID`。`/login`、`/signup` 是 `AuthShellForm` 的**禁用态外观**，
输入框与提交按钮全部 `disabled`，注释写明"不提交凭据、不推断会话、不创建示例业务数据"。

本计划要交付的是一套完整登录体系：账密登录、注册（邮件验证码）、忘记密码（邮件验证码）、
验证码 10 分钟有效、零第三方依赖的人机验证、登录后账户数据归属，以及
AI 功能触发时的登录弹窗与跳转。

### 0.2 硬边界（越界即失败）

1. **不修改 `server/**` 任何文件。** `server/src/capture/{imap-email,credentials}.ts`
   是**采集 agent 出站登录被演示站点**用的（IMAP 只读收码，过对方站点的"禁一次性邮箱"
   过滤），方向与本计划相反。**不得复用、不得 import、不得把它的 `IMAP_*` env 搬到
   Next 侧。** 详见 §6。
2. **不合并两套系统的 env 加载器、model routing、job 状态机**（AGENTS.md §0）。
3. **不引入第二套设计系统。** 登录页只能用 `/playbook` 已登记组件或 `src/components/marketing/*`
   已有组件族，不得本地拼装平行的 Button / Card / Dialog（AGENTS.md §3）。
4. **不新增 `openai` 直接 import**（`verify:v3` 债务上限 3，当前用满）。
5. **secret 只引用变量名，不回显值**；禁止创建携带 secret 的 `NEXT_PUBLIC_*`；
   凭据只存加密内容（AGENTS.md §7）。
6. **规模门禁**：`page.tsx` 硬上限 300 行、一般生产文件 350、schema / repository 400、
   单函数目标 50。TypeScript strict，禁止 `any`。
7. **不得把新超限文件写进 `verify:v3` baseline 掩盖门禁**。

### 0.3 与 PLAN-001 的协调点

文件级不相交，唯一共享文件是 `docs/conventions/routing.md` §9：

| 段落 | 所有者 | 动作 |
| --- | --- | --- |
| §9.1 | PLAN-001 先追加一段"入站边界由部署层保证" | 本计划再做**完整分层改写** |
| §9.2 目标守卫矩阵 | 本计划 | 逐行核销：哪些已实现、哪些仍是目标 |
| §9.3 认证落地的最小要求 | 本计划 | 按实际覆盖程度改写，**不得虚报** |

两边不要同时改同一段。若 PLAN-001 尚未落地，本计划可以先做，但 §9.1 里必须保留
"入站边界仍未收敛"的表述，直到 PLAN-001 完成。

另一个共享点：取证脚本的凭据入口。PLAN-001 §1.6 会在 `scripts/verify/e2e-smoke.ts`
加一个只读 env 的凭据注入出口。**本计划复用同一个出口**（改成携带会话 cookie），
不得在两处各写一份注入逻辑。

### 0.4 已核实的现状事实（写计划时实测，实施前请复核）

| 项 | 实测值 |
| --- | --- |
| 认证守卫 | `next-auth` / `getServerSession` / `requireAuth` / 入站 401 在 `src/**` 零命中 |
| `proxy.ts` / `middleware.ts` | 均不存在 |
| `/login`、`/signup` | `src/app/(auth)/{login,signup}/page.tsx` → `AuthShellForm`，全 disabled；`noIndex: true` |
| `(auth)` 布局 | `src/app/(auth)/layout.tsx`，用 `ds-app-gradient` + `ds-text`（**应用侧** token，不是营销侧） |
| 落地页 | `src/app/(marketing)/page.tsx`，用 `MarketingProviders` + `text-foreground` 一族（**营销侧** token） |
| 现有实体 | `workspaces`、`projects`、`workspace_settings`（`src/lib/db/schema/core.ts`）；**无 `users` / `sessions` / `workspace_members`** |
| `AuthShellForm` 声明的未来来源 | `User`、`Workspace`、`WorkspaceMembership`、`Session`（`UnwiredPanel` 的 `sources`） |
| workspace 行的创建点 | `src/features/canvas/actions.ts:34` —— `createProject()` 里 upsert `LOCAL_WORKSPACE_ID` |
| `LOCAL_WORKSPACE_ID` | 常量在 `src/lib/db/client.ts:11`；`src/**` 命中 **175 处 / 39 文件**，其中**生产文件 29 个** |
| 队列 workspace 列 | `pipeline_runs` / `task_attempts` **已有 `workspaceId` 列**；`claim()` 目前按 `LOCAL_WORKSPACE_ID` 过滤 |
| 迁移 | `src/lib/db/migrations/pg`，journal 已有 `0000`–`0003`，下一个是 `0004`，`when` 必须严格单调递增 |
| 加密基建 | `src/features/credentials/credential-envelope.ts`：AES-256-GCM + AAD 绑定 workspace，`CVC_CREDENTIAL_MASTER_KEY` 为 canonical 32 字节 base64，**无明文 fallback** |
| 哈希库 | **无**。`bcrypt` / `argon2` 都不在依赖里 → 用 `node:crypto` 的 `scrypt` |
| 邮件库 | **无**（根与 `server/` 都没有）。`server/.env` 有 `SMTP_HOST`（阿里云）、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS`、`SMTP_FROM_NAME` |
| 可复用组件 | `src/components/ui/`：`dialog.tsx`（600px、portal、`z-[1000]`）、`text-field.tsx`、`text-area.tsx`、`button.tsx`、`toast.tsx`、`card.tsx` 等，均有 `.demo.tsx` 并登记在 `src/app/playbook/registry.ts` |
| 组件门禁 | `canonical-components.test.ts`（token 断言）、`dialog-layering.test.ts`、`playbook/registry.test.ts` |
| 海报素材 | `public/img/login.png` 存在，**5,140,649 字节（约 4.9 MB）** ← 必须处理，见 §4.2 |
| 客户端流式 | 同源 `EventSource`（`use-project-status-stream.ts:96`、`use-stage-stream.ts:66`）→ **会话必须走 cookie，不能走 header token** |
| `/products/*` 索引 | 无 `noIndex`；`robots.ts` 只 disallow `/api/`、`/private/`、`/share/` |

---

## 1. 架构决策（必须先定，后面全部依赖这一节）

### 1.1 身份与 workspace 的关系

产品要求包含"注册账户"，即会有多个用户。这决定了不能停在单工作区。三个选项：

| 方案 | 说明 | 代价 | 结论 |
| --- | --- | --- | --- |
| A 全员共用 `LOCAL_WORKSPACE_ID` | 只加身份，不改归属 | 用户 B 能看见用户 A 的全部项目与产物 | **不可接受**（有注册就必须隔离） |
| B 一人一 workspace | 注册时创建 `workspaces` 行 + `workspace_members` 关系 | 必须替换 29 个生产文件里的 `LOCAL_WORKSPACE_ID`，并解决队列传递 | **推荐** |
| C 完整多租户 + 邀请协作 | B + 成员角色 + 邀请流 | 再加一层权限矩阵 | 首版不做，schema 预留 |

选 **B**。好消息是数据模型已经为它准备好了：每张业务表都带 `workspaceId`，
`projects` 是 `(workspaceId, id)` 复合主键，artifacts / canvas_nodes / task_attempts /
provider_credentials 的查询条件里都已经带 workspace 过滤。**缺的只是"workspaceId 从哪来"。**

### 1.2 workspaceId 的单一读取口（本计划最关键的设计）

绝对不要在 29 个文件里各写一份"从哪拿 workspaceId"。做法：

1. 新增 `src/lib/auth/workspace-context.ts`，内部用 `node:async_hooks` 的
   `AsyncLocalStorage<{ workspaceId: string; userId: string }>`，导出：
   - `runInAuthContext(ctx, fn)` —— 建立上下文；
   - `currentWorkspaceId(): string` —— 取值，**未建立上下文时必须抛错，不得回落到常量**。
2. 请求路径：在每个 `/api/*` handler 与需要数据的 Server Component 入口用会话解析出
   `{ userId, workspaceId }` 后 `runInAuthContext(...)` 包裹业务调用。
3. 队列路径（**最容易漏的一条**）：`task_attempts` 已有 `workspaceId` 列。
   `claim()` 去掉 `LOCAL_WORKSPACE_ID` 过滤，改为把领到的 attempt 的 `workspaceId`
   放进上下文，再 `runInAuthContext` 包裹 handler 执行。
4. 29 个生产文件的改动降级为**把 `LOCAL_WORKSPACE_ID` 换成 `currentWorkspaceId()`**，
   属于机械替换，不改函数签名，diff 可审。
5. `LOCAL_WORKSPACE_ID` 常量**保留但降级**为"历史数据迁移与 bootstrap 专用"，
   并在注释里写明禁止在业务查询中使用。可加一条 lint / 契约测试锁住这一点。

为什么不用"显式参数透传"：它更纯，但要改 29 个文件的函数签名与全部调用链，
diff 规模会盖过真正的认证逻辑，评审失去信号。ALS 的代价是"忘记建立上下文"会在运行时抛错
——通过 `currentWorkspaceId()` 无 fallback 的设计，把它变成**立即可见的失败**而不是静默串号。

### 1.3 会话形态：cookie，不用 header token

硬约束：客户端用同源 `EventSource`，**不能设置自定义请求头**。若把会话放在
`Authorization` 头，画布状态流会静默退化成 1.5s 轮询兜底，极难归因。

因此：

- 会话 id 存 **HttpOnly + Secure + SameSite=Lax** cookie（`Lax` 足够，本产品无跨站 POST 需求）；
- 服务端 `sessions` 表持久化（不是无状态 JWT），这样"登出即失效""改密码踢下线"都能真实生效；
- cookie 里只放**不可猜测的随机 id**，DB 里存其哈希（见 §1.4），不放任何用户信息；
- 不使用 `next-auth`：本产品只需要账密 + 邮件验证码，引入它会带来第二套 session / 回调
  约定，且它对 `LOCAL_WORKSPACE_ID` 改造没有帮助。**这是有意不引入，请勿"顺手优化"成它。**

### 1.4 密码与验证码的哈希（零第三方依赖）

依赖里没有 `bcrypt` / `argon2`，也不需要引入：

- **密码**：`node:crypto` 的 `scrypt`（异步版本），每用户独立随机 salt，参数与 salt、
  算法标识一起编码存库（例如 `scrypt$N$r$p$salt$hash`），便于将来提参数而不破旧记录。
  校验用 `timingSafeEqual`。
- **会话 id**：`randomBytes(32)` 的 base64url 作为明文给 cookie，DB 存 SHA-256。
  会话 id 是高熵随机值，不需要 scrypt。
- **邮件验证码**：6 位数字对用户友好，但熵低，因此必须**同时**做到：DB 只存哈希
  （SHA-256 + 随机 salt 或直接 scrypt）、限制尝试次数、10 分钟过期、一次性消费。
- **绝不复用 `CVC_CREDENTIAL_MASTER_KEY`** 去加密密码。那个 key 的职责是 provider 凭据
  可解密存储；密码必须是不可逆哈希。两者不能混（AGENTS.md §7）。

### 1.5 邮件通道：阿里云邮件推送

`server/.env` 里已有 `SMTP_HOST`（阿里云域名）、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS`、
`SMTP_FROM_NAME`。两条路：

- **A（推荐）SMTP + `nodemailer`**：依赖由 pnpm 安装并**锁精确版本**（AGENTS.md §4）。
  阿里云邮件推送标准 SMTP 接入，最少的自研面。
- **B 阿里云 DirectMail HTTP API（`SingleSendMail`）**：签名用 `node:crypto` 手算，
  零新依赖。但**需要 `AccessKeyId` / `AccessKeySecret`，当前 `server/.env` 里没有**
  ——走这条要先向用户索取新凭据。
- **不要手写 SMTP 客户端**（STARTTLS + AUTH LOGIN + 行折叠 + 编码），约 150 行且易错，
  收益为负。

**env 归属（关键，别做错）**：`server/.env` 是 worker 的，Next 侧**不得读它**。
按仓库既有先例（`GEMINI_API_KEY` / `STEPFUN_API_KEY` 的"各自为政 + 值复制"模式），做法是：

1. 在根 `.env.example` 新增 Next 侧变量名，**值留空**：
   `CVC_MAIL_SMTP_HOST` / `CVC_MAIL_SMTP_PORT` / `CVC_MAIL_SMTP_USER` /
   `CVC_MAIL_SMTP_PASS` / `CVC_MAIL_FROM_ADDRESS` / `CVC_MAIL_FROM_NAME`；
2. 真实值由用户从 `server/.env` 复制到被 git 忽略的根 `.env.local`；
3. 邮件模块 `import 'server-only'`，任何值都不进客户端 bundle；
4. `tests/env.test.ts` 已有敏感变量断言，新增变量要确认不破坏它。

发信必须做到：失败不阻塞注册流程的**安全语义**（见 §3.4 的"不泄露账号是否存在"）、
发信频率限制（§3.5）、以及**日志只记分类信息，不记验证码与收件人全量地址**（AGENTS.md §6）。

### 1.6 人机验证：三个零依赖方案，全部启用

要求是"最简单、无第三方库"。单独任何一个都弱，组合起来对脚本刷量足够：

| # | 方案 | 实现要点 | 强度 |
| --- | --- | --- | --- |
| 1 | **蜜罐字段** | 表单里一个 `aria-hidden` + CSS 隐藏的输入，正常用户永远为空；非空即拒 | 低成本、挡掉大部分无脑脚本 |
| 2 | **最短填写时长 + 签名时间戳** | 服务端下发 `issuedAt` 并用 HMAC 签名，提交时校验签名且 `now - issuedAt` 在 [1.5s, 10min] 区间 | 挡即时提交 |
| 3 | **算术 / 字符验证码（SVG 渲染）** | 服务端生成题目，答案哈希进短期签名 token（不落库或落 `auth_throttle`），SVG 用手写字符串拼接，**不引入 canvas / 图形库** | 需要人读，成本仍为零依赖 |

补充第 4 道（不是人机验证但同等重要）：**按 IP + 按邮箱的速率限制**（§3.5）。

无障碍要求：验证码必须有非视觉替代（算术题本身可读；SVG 要带 `role="img"` 与
`aria-label` 或配套文字提示），且**状态不能只靠颜色表达**（AGENTS.md §6）。

---

## 2. 数据模型（migration `0004`）

### 2.1 新增表

落在 `src/lib/db/schema/auth.ts`（新文件，schema 硬上限 400 行；按聚合拆分，
不要塞进 `core.ts`），并在 `src/lib/db/schema/index.ts` 导出。

**`users`**

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | uuid | PK，`defaultRandom()` |
| `email` | text | **唯一索引建在 `lower(email)` 上**，避免大小写重复注册 |
| `emailVerifiedAt` | timestamptz | nullable；未验证不得登录 |
| `name` | text | notNull |
| `passwordHash` | text | notNull，格式见 §1.4 |
| `passwordUpdatedAt` | timestamptz | 改密码后据此失效旧会话 |
| `status` | text | `active` / `disabled`，CHECK 约束 |
| `createdAt` / `updatedAt` | timestamptz | `defaultNow()` |

**`workspace_members`**（预留 §1.1 方案 C，首版每人一条 `owner`）

| 列 | 说明 |
| --- | --- |
| `workspaceId` | FK → `workspaces.id`，`onDelete: cascade` |
| `userId` | FK → `users.id`，`onDelete: cascade` |
| `role` | `owner` / `member`，CHECK |
| PK | `(workspaceId, userId)` |
| 额外索引 | `(userId)`，登录后解析默认 workspace 用 |

**`sessions`**

| 列 | 说明 |
| --- | --- |
| `id` | uuid PK（内部标识，不下发） |
| `tokenHash` | text，**唯一**，SHA-256(cookie 明文) |
| `userId` | FK → `users.id`，cascade |
| `workspaceId` | FK → `workspaces.id`；登录时解析并固化，避免每请求再 join |
| `expiresAt` | timestamptz，notNull |
| `createdAt` / `lastSeenAt` | timestamptz |
| `userAgentHash` / `ipHash` | 可选，只存哈希，便于异常排查而不存 PII |
| 索引 | `(userId)`、`(expiresAt)` |

**`email_verification_codes`**

| 列 | 说明 |
| --- | --- |
| `id` | uuid PK |
| `email` | text notNull（注册时用户还不存在，所以按 email 而不是 userId） |
| `purpose` | text，CHECK `in ('signup','password_reset')` |
| `codeHash` | text notNull |
| `expiresAt` | timestamptz notNull（签发时 + 10 分钟） |
| `consumedAt` | timestamptz nullable |
| `attemptCount` | integer default 0，CHECK `>= 0` |
| `createdAt` | timestamptz |
| 索引 | `(email, purpose, expiresAt)` |

**`auth_throttle`**（速率限制与人机验证 token 的落点，见 §3.5）

| 列 | 说明 |
| --- | --- |
| `key` | text PK（如 `ip:<hash>:signup`、`email:<hash>:reset`） |
| `windowStartedAt` | timestamptz |
| `count` | integer |

### 2.2 约束与清理

- **过期数据必须有清理路径**：`sessions`、`email_verification_codes`、`auth_throttle`
  三张表都会无限增长。做法是在登录 / 签发验证码这些低频写入路径上**顺手删除已过期行**
  （`DELETE WHERE expiresAt < now()`），不要新增后台定时任务（会成为第二套调度真值）。
- **不要给 `users` 加 `workspaceId` 列**。归属关系由 `workspace_members` 表达，
  否则将来做协作时会出现两套真值。
- `projects` 等既有表**不加 `userId` 列**。归属通过 `workspaceId` 表达，
  加 `userId` 会与 `workspace_members` 冲突（详见 §5.1）。

### 2.3 迁移纪律（踩过的坑）

1. 用 `pnpm db:generate` 生成，**不要手写 SQL 文件**。
2. **`meta/_journal.json` 的 `when` 必须严格大于 `0003` 的 `1785002500000`。**
   时间戳乱序曾让 `0003` 被 drizzle 判定过期而跳过，造成 schema 与 DB 不一致、
   全库建项目 400（ISSUE-008 / ISSUE-012）。
3. **连续执行 `pnpm db:migrate` 两次**，第二次必须无变更。
4. 数据迁移（把既有 `LOCAL_WORKSPACE_ID` workspace 交给第一个注册用户）见 §5.5，
   **不得在 migration 里硬编码生成的 ID**（AGENTS.md 工具约束）。

---

## 3. 服务端实现

### 3.1 目录与分层

```text
src/features/auth/
  index.ts                     公开导出（跨域只走这里）
  schemas.ts                   zod 输入契约（邮箱、密码强度、验证码格式）
  password.ts                  scrypt 哈希与校验（纯函数，可单测）
  verification-code.ts         生成/哈希/校验/过期与尝试次数（纯函数 + 仓储调用分离）
  human-check.ts               蜜罐 / 时间戳签名 / 算术验证码（纯函数）
  session.ts                   会话签发、解析、失效（application 层）
  mailer.ts                    'server-only'；阿里云邮件推送发送口，唯一出口
  mail-templates.ts            验证码邮件文案（中文，无 emoji）
  auth-repository.ts           users / sessions / codes / throttle 的 SQL（≤400 行）
  throttle.ts                  速率限制
src/lib/auth/
  workspace-context.ts         AsyncLocalStorage 上下文（§1.2）
  session-cookie.ts            cookie 读写与属性（HttpOnly/Secure/SameSite/maxAge）
```

分层要求（AGENTS.md §3 / §5）：`src/app` 只做参数解析、组合与响应映射，不放 SQL；
纯函数与 IO 分离，让 `password.ts` / `verification-code.ts` / `human-check.ts` 可以不连库单测。

### 3.2 `proxy.ts`（Next 16 取代 `middleware.ts`）

**必须新建 `proxy.ts`，不得建 `middleware.ts`**（AGENTS.md §5）。职责：

- 拦 `/products/*`：无有效会话 → `302 /login?next=<原路径>`（`routing.md` §9.2）；
- 已登录访问 `/login`、`/signup` → `302 /products/dashboard`；
- **不在 proxy 里查数据库**。proxy 只做 cookie 存在性与签名/格式的廉价判断，
  真正的会话校验在 handler / layout 里做。原因：proxy 运行在每个请求上，
  连库会成为全站延迟与连接数压力（`postgres.js` 未传连接参数，默认连接数有限）。
- `/api/*` **不靠 proxy 兜底**，每个 handler 自己校验（§3.3）。理由同上，且 API 需要
  的是 401 / 404 语义而不是 302。

### 3.3 API 路由清单

全部落在 `src/app/api/auth/` 下，薄入口 + `dynamic = 'force-dynamic'`：

| 路由 | 方法 | 行为 |
| --- | --- | --- |
| `/api/auth/signup/code` | POST | 校验人机验证 + 速率限制 → 签发 `signup` 验证码并发信 |
| `/api/auth/signup` | POST | 校验验证码 → 创建 `users` + `workspaces` + `workspace_members` + 会话（单事务） |
| `/api/auth/login` | POST | 账密校验 → 签发会话；失败计入 throttle |
| `/api/auth/logout` | POST | 删除会话行 + 清 cookie |
| `/api/auth/password/code` | POST | 签发 `password_reset` 验证码并发信 |
| `/api/auth/password/reset` | POST | 校验验证码 → 更新 `passwordHash` + `passwordUpdatedAt` + **失效该用户全部会话** |
| `/api/auth/human-check` | GET | 下发算术/字符验证码与签名 token |
| `/api/auth/session` | GET | 返回当前登录态最小视图（`{ authenticated, email, workspaceName }`），供客户端弹窗判断 |

**既有 `/api/*` 的改造**：13 条既有路由（`artifacts/[id]`、`director/pipeline`、
`director/stage`、`director/stream/**`、`jobs/[id]`、`projects`、`projects/[id]`、
`render`、`render/export`、`render/thumbnails`、`settings`）都要在入口解析会话 →
`runInAuthContext` 包裹。`/api/ping` 保持公开（健康检查）。

### 3.4 错误语义（不得泄露信息）

| 情况 | 响应 | 说明 |
| --- | --- | --- |
| 未登录调 `/api/*` | 401 + 类别文案 | 不带任何用户信息 |
| 登录失败（账号不存在 / 密码错） | **同一个 401 同一句文案** | 不得区分，否则成了账号枚举接口 |
| 请求验证码（邮箱已注册 / 未注册） | **同一个 200 同一句文案** | 忘记密码尤其重要；是否真发信在服务端决定 |
| 验证码错误 / 过期 / 已消费 | 422 | 计入 `attemptCount`；超阈值直接作废该码 |
| 人机验证失败 | 422 | 不解释具体哪一项失败 |
| 超出速率限制 | 429 + `Retry-After` | |
| 已登录但 `projectId` 不属于当前 workspace | **404** | `routing.md` §9.2：一律用 404 掩盖归属错误，不区分"不存在"与"无权限" |
| provider / SMTP 原始错误 | **不外泄** | 只回类别文案，原始信息经 `console.error` 落服务端日志（AGENTS.md §6；`next.config.ts` 已保留 error/warn） |

### 3.5 速率限制

用 `auth_throttle` 表，按固定窗口计数（不需要精确令牌桶）：

| 维度 | 建议阈值 |
| --- | --- |
| 同 IP 签发验证码 | 10 / 小时 |
| 同邮箱签发验证码 | 3 / 10 分钟，5 / 天 |
| 同邮箱登录失败 | 10 / 15 分钟，超限要求人机验证 |
| 同验证码尝试次数 | 5 次，超限作废 |

IP 只存哈希（不存原值，避免 PII 落库）。阈值写成常量并可被单测覆盖，不要散落魔法数字。

---

## 4. 前端实现

### 4.1 登录页布局与风格决策（**先解决这个冲突**）

需求是"登录页与落地页风格保持一致"。但实测存在一个真实冲突：

- 落地页 `(marketing)` 用的是营销 token 族（`text-foreground`、`MarketingProviders`、
  `Header` / `Hero` 的白字 + 深底 + 动效）；
- 现有 `(auth)/layout.tsx` 用的是**应用侧** `ds-*` token（`ds-app-gradient`、`ds-text`），
  而 `ds-*` 的像素真值在 `docs/designs/canvas.pen`。

AGENTS.md §3 要求"视觉只有一套"，指的是**不得本地拼装平行原语**；`components/marketing/`
与 `components/ui/` 是目录约定里已存在的两个合法族。因此可行的解法是**明确归属**，
不是混用：

**决策（推荐）**：`/login`、`/signup` 归**营销侧视觉**，因为它们是进入应用之前的公开表面，
与落地页连续。具体：

1. `(auth)/layout.tsx` 改为复用营销侧的排版基底与 `Header` / `Footer`（或其精简版），
   保持与落地页同一套字体尺度、底色与圆角语言；
2. 表单控件仍然复用 `src/components/ui/` 的 `TextField` / `TextArea` / `Button` / `Toast`
   —— **不要为登录页新写一套输入框**。若营销侧配色下 `ds-*` token 对比度不足，
   通过 `className` 覆盖间距/宽度，**不改组件内部 token**；
3. 这个决策必须写进 `docs/designs/Design-system-inventory.md`（当前该文件**没有**任何
   登录页条目），说明 `/login` 属于营销视觉 + `ui/` 控件的组合，避免下一个人再纠结；
4. 若用户更希望登录页跟随应用侧 `ds-*`（与 `canvas.pen` 一致），则改为保留现有
   `(auth)/layout.tsx` 基底 —— 但**必须二选一并落文档**，不能两套混着来。

**版式**（桌面 `lg` 及以上左右两栏，移动端单栏，海报降级为顶部窄幅或隐藏）：

```text
┌───────────────────────────┬────────────────────────────────┐
│  public/img/login.png      │  Logo                          │
│  海报（object-cover）       │  H1 登录 PurpleInk              │
│  可叠一行品牌文案            │  ─ 邮箱 / 密码（TextField）      │
│  移动端隐藏或降为窄幅        │  ─ 人机验证（§1.6）              │
│                            │  ─ 登录（Button primary）        │
│                            │  ─ 忘记密码 / 去注册（Link）      │
└───────────────────────────┴────────────────────────────────┘
```

`/signup` 与 `/password/reset` 复用同一外壳（同一左侧海报），只换右侧表单，
**不要复制三份布局**。现有 `AuthShellForm` 的 `FIELDS` 结构已经是 login / signup
两套字段表，沿用这个模式扩展第三套。

### 4.2 `login.png` 的处理（必须做）

实测该文件 **约 4.9 MB**。直接 `<img>` 或不加约束的 `next/image` 会让登录页成为全站最重
的页面，而登录页是新用户的第一屏。

要求：

1. 用 `next/image`，给显式 `sizes` 与 `priority`（它是首屏 LCP 元素）；
2. **压缩或转 WebP/AVIF 落到 `public/img/`**，目标 < 400 KB；保留原图可放 `docs/designs/`
   或直接替换，但**替换前后都要记录文件大小与 SHA-256**（可追溯性）；
3. 移动端不要下载大图：用 `sizes` + CSS 隐藏不足以省流量，`hidden` 的 `next/image`
   仍可能被请求——移动端布局里**直接不渲染该节点**；
4. `alt` 必须是有意义的中文描述，不得为空字符串（除非明确作纯装饰并 `aria-hidden`）。

### 4.3 复用 `/playbook` 已登记组件（禁止新造）

| 需求 | 复用 | 位置 |
| --- | --- | --- |
| 登录提示弹窗 | `Dialog` | `src/components/ui/dialog.tsx`（600px、portal、`z-[1000]`、`role="dialog"` + `aria-modal`） |
| 输入框 | `TextField` | `src/components/ui/text-field.tsx` |
| 按钮 | `Button`（`primary` / `gray`） | `src/components/ui/button.tsx` |
| 错误 / 成功提示 | `Toast` | `src/components/ui/toast.tsx` |
| 卡片容器 | `Card` | `src/components/ui/card.tsx` |

参考实现：`src/app/_components/new-project-dialog.tsx` 已经把
`Dialog + TextField + TextArea + Toast + Button` 组合成一个提交型弹窗，**照它的形状写**
（受控 `open`、提交中禁用关闭、错误用 `Toast` 呈现）。

若确实需要新组件（例如"验证码输入 + 倒计时重发"），必须：

1. 落在 `src/components/ui/`，附 `.demo.tsx`；
2. 登记进 `src/app/playbook/registry.ts`，并让 `registry.test.ts` 通过；
3. 只用 `ds-*` token，满足 `canonical-components.test.ts` 的断言；
4. 若涉及浮层叠放，满足 `dialog-layering.test.ts`。

### 4.4 AI 功能的登录门（弹窗 → 跳转）

**触发点清单**（实测的客户端调用出口，不要漏）：

| 入口 | 文件 | 触发的 AI / 算力行为 |
| --- | --- | --- |
| 新建项目 | `src/app/_components/new-project-api.ts` | `POST /api/projects` + `POST /api/director/stage`（INGEST） |
| 画布节点执行 / autopilot | `src/app/products/(app)/canvas/[projectId]/canvas-action-api.ts` | `/api/director/stage`、`/api/render`、`/api/director/pipeline` |
| 分镜渲染 | `src/app/products/(app)/shots/[shotId]/shot-api.ts` | `POST /api/render` |
| 导出 | `src/app/products/(app)/export/[projectId]/export-api.ts` | `POST /api/render/export` |
| 落地页 Try | `src/components/marketing/header.tsx` 的 `Try it` → `PRODUCTS_ROUTES.projects` | 跳转进应用 |
| 落地页 AI 演示 | `src/components/marketing/launch-composer.tsx` | `/api/engine/*`（**worker**，不是本套 AI） |

**实现方式（重要）**：不要在这 4 个 api 模块里各写一遍弹窗逻辑。做法：

1. 新增一个客户端组件 `src/features/auth/login-required-dialog.tsx`（`'use client'`），
   内部用 `Dialog` + `Button`，文案说明"继续使用 AI 生成需要登录"，主按钮
   `router.push('/login?next=' + encodeURIComponent(当前路径))`；
2. 新增一个轻量 hook（如 `useRequireLogin()`）：调用 AI 动作前先判断登录态
   （来自 `/api/auth/session` 或由 Server Component 下传的 props），未登录则打开弹窗并
   **中止请求**；
3. `/products/*` 页面本身已由 `proxy.ts` 拦住，所以弹窗的**真实价值在营销页**
   （`Try it`、`LaunchComposer`）与**会话中途过期**两种场景。会话过期时，api 模块收到 401
   要能把状态回传给 hook 触发弹窗 —— 因此 4 个 api 模块的改动只有一处：
   **把 401 映射成一个可识别的错误类型**，不要各自 `alert` 或各自跳转；
4. `LaunchComposer` 打的是 worker（`/api/engine/*`），它与本套认证无关。是否也要求登录
   是产品决策：若要求，则在该组件调用 `startRender()` 前接同一个 hook；**不得因此改
   `server/**`**。

回跳规则：`?next=` 只接受**站内相对路径**（以 `/` 开头且不以 `//` 开头），
否则忽略并回落到 `/products/dashboard`。这是开放重定向的必要防护。

### 4.5 未登录态的呈现纪律

- 不做"永久 Skeleton"、不做"可点击但无行为的按钮"（AGENTS.md §6）；
- 需要登录的操作在未登录时**显式禁用并给出原因**（`routing.md` §9.2 最后一行的
  "上下文缺失但路由本身合法"同一口径）；
- 登录后不要隐式创建示例项目或示例数据（`AuthShellForm` 现有注释已声明这条约束）。

### 4.6 索引与元数据

- `/login`、`/signup` 已有 `noIndex: true`，新增的 `/password/reset` 同样要加；
- **`/products/*` 目前既无 `noIndex`，`robots.ts` 也只 disallow `/api/`、`/private/`、
  `/share/`**。本计划顺手补齐：给 `products/(app)/layout.tsx` 或各 page 的 metadata 加
  `noIndex`，并在 `robots.ts` 的 disallow 里加 `/products/`。
  这属于路由元数据，需按 `routing.md` §3 的清单同步该文档。

---

## 5. 登录后的数据绑定（同账户资料同步）

### 5.1 先回答"画布是本地存储还是数据库"

**是数据库。** 实测：画布节点、边、项目、执行记录、产物元数据全部在 Postgres
（`canvas_nodes`、`projects`、`pipeline_runs`、`task_attempts`、`artifacts`），
唯一的"本地"部分是产物字节落在 `DATA_DIR`（`ARTIFACTS_DIR = <DATA_DIR>/artifacts`）。

所以**必须做归属绑定**，不能跳过。

### 5.2 绑定方式：绑 workspace，不绑 userId 列

结论先行：**不要给 `projects` / `canvas_nodes` / `artifacts` 加 `userId` 列。**

理由：这些表已经有 `workspaceId`，且已经是复合主键与全部查询条件的一部分。再加一列
`userId` 会造成两套归属真值（"这个项目属于谁"有两个答案），将来做协作时必然打架。
正确做法是 §1.1 方案 B：`users` ← `workspace_members` → `workspaces` ← 业务数据。

改造清单（29 个生产文件，机械替换 `LOCAL_WORKSPACE_ID` → `currentWorkspaceId()`）：

```text
src/app/api/settings/route.ts
src/features/ai/{config,gemini-config,model-routing,stepfun-adapter}.ts
src/features/artifacts/service.ts
src/features/audio/{narration-repository,repository,runtime-repository}.ts
src/features/canvas/{actions,fan-out,queries,status}.ts
src/features/director/{advance-repository,runtime-artifact-source,runtime-artifact-writer,
                      runtime-repository}.ts
src/features/director/tools/write-artifact.ts
src/features/projects/project-compatibility.ts
src/features/render/{cache,persistence,render-artifact-repository,
                     render-shot-repository,repository}.ts
src/lib/db/{client,index}.ts          ← 常量降级为迁移/bootstrap 专用
src/lib/queue/{in-process-queue,query,runtime-config}.ts   ← 见 §5.3
```

**特别注意 `src/features/canvas/actions.ts:34`**：`createProject()` 目前会 upsert
`LOCAL_WORKSPACE_ID` 的 `workspaces` 行。这段必须删掉 —— workspace 的创建点转移到
注册流程（`/api/auth/signup`），项目创建不再负责造 workspace。

### 5.3 队列的 workspace 传递（最难的一块，别漏）

队列是**没有请求上下文的后台消费者**。当前：

- `enqueue()` 写 `pipeline_runs` / `task_attempts` 时填 `LOCAL_WORKSPACE_ID`；
- `claim()` 的 where 里带 `eq(taskAttempts.workspaceId, LOCAL_WORKSPACE_ID)`；
- `query.ts` 的 job 查询同理。

改造：

1. `enqueue()` 从 `currentWorkspaceId()` 取值（入队发生在请求上下文内，成立）；
2. `claim()` **去掉** workspace 过滤（否则只消费一个 workspace 的作业），
   仍保留 `FOR UPDATE SKIP LOCKED`；
3. 领到 attempt 后，用**该 attempt 行的 `workspaceId`** 建立上下文再执行 handler：
   `runInAuthContext({ workspaceId: row.workspaceId, userId: SYSTEM }, () => handler(...))`；
4. `runtime-config.ts` 的并发配额目前是"workspace 级偏好"（`workspace_settings` 的
   `queue.laneQuotas`）。多用户后必须决策：**配额是进程级还是每 workspace 级**。
   推荐**进程级**（它约束的是本机 CPU，与用户无关），即把这一项从
   `workspace_settings` 迁到进程级配置，或明确规定"只读 owner workspace 的值"。
   **这项决策会直接影响 ISSUE-011 与 ISSUE-015 P-4，见 §9。**
5. `query.ts` 的 job 状态查询必须**同时**按 `workspaceId` 过滤（防止 A 用户查 B 的 jobId），
   这里的 workspaceId 来自请求上下文，不是 attempt 行。

### 5.4 provider 凭据的归属（产品决策，必须先定）

`provider_credentials` 已是 workspace 级，加密时 **AAD 绑定 workspace**
（`credential-envelope.ts`）。多用户后有两种语义：

- **每用户自带 key**（`/products/settings` 各自填）：符合现有加密设计，零改动，
  但每个新用户不填 key 就跑不了管线；
- **平台统一 key**：需要一个"系统 workspace"的凭据 + 用量归属与配额，属于新需求。

首版建议**每用户自带 key**，并在设置页文案里如实说明。**不要偷偷 fallback 到别的
workspace 的 key** —— 那会让 AAD 校验失败或造成跨账户用量串账。

### 5.5 既有数据的归属迁移

现在库里的数据全挂在 `LOCAL_WORKSPACE_ID`。方案：

1. 迁移脚本（`scripts/migration/` 下新增，走 `tsx`）：接受一个已注册用户的 email，
   把该 `users.id` 与 `LOCAL_WORKSPACE_ID` 建立 `workspace_members(owner)` 关系；
2. **不搬数据、不改 `workspaceId`**，只补成员关系 —— 这是最小且可逆的做法；
3. 脚本必须幂等（重复执行不报错、不产生第二条成员关系）；
4. **不要在 SQL migration 里做这件事**（需要交互输入 email，且不得硬编码 ID）。

### 5.6 产物字节的隔离

`ARTIFACTS_DIR` 下的目录结构是**按 kind / projectId** 组织的，不含 workspaceId。
不需要改目录结构：`readArtifact()` 在读字节之前先按
`workspaceId AND id AND projectId` 查 DB 行，DB 行就是守门人。

但**必须验证**：改造后 A 用户拿 B 用户的 `(projectId, artifactId)` 组合请求
`/api/artifacts/{id}?projectId=`，返回 **404**（不是 403、不是 200）。这是 §8 的必测项。

---

## 6. 不影响后端 agent 登录板块

`server/src/capture/` 里的"登录"是**另一件事**，与本计划零交集：

| | 本计划 | `server/` 采集 agent |
| --- | --- | --- |
| 方向 | 别人登录 PurpleInk（入站） | agent 出站登录**被演示的第三方站点** |
| 机制 | 账密 + 邮件验证码 + 会话 cookie | `credentials.ts` 三级优先级：用户提供测试账号 → IMAP 真实邮箱自助注册 → 无凭据仅采公开内容 |
| 邮件 | **发信**（阿里云邮件推送 SMTP） | **收信**（`imap-email.ts` / ImapFlow 读验证码或激活链接） |
| env | 根 `.env.local` 的 `CVC_MAIL_*` | `server/.env` 的 `IMAP_*`、`SIGNUP_PASSWORD` |

执行纪律：

1. **不修改 `server/**` 任何文件**（`docs/issues/README.md` §0 硬边界第 1 条）；
2. 不 import `server/src/capture/*`，不复用它的 `IMAP_*` 变量；
3. 不把 `SIGNUP_PASSWORD` 这类 worker 侧变量用于 Next 侧任何逻辑；
4. `/api/engine/*` 代理行为不变。若决定"落地页 AI 演示也要求登录"，只在 Next 侧的
   客户端组件加门（§4.4 第 4 点），worker 侧一行不动；
5. `tests/job-phase-contract.test.ts` 锁定的两套 `JobPhase` 合法重复不得"消除"。

---

## 7. 分阶段实施与提交切分

分三阶段，每阶段独立可验收、独立提交。**不要一次性提交全部。**

### 阶段 A · 身份与会话（不碰 `LOCAL_WORKSPACE_ID`）

范围：migration `0004`、`src/features/auth/**`、`src/lib/auth/**`、`proxy.ts`、
`/api/auth/*`、登录/注册/重置三个页面、`login-required-dialog`。

此阶段仍是单工作区：所有注册用户暂时都关联到 `LOCAL_WORKSPACE_ID`。
**这是一个临时状态，必须在阶段 B 立刻收口**，且阶段 A 不得部署到多用户可访问的环境。

提交：

1. `feat(auth): 新增 users/sessions/verification 数据模型`（schema + migration，两次幂等验证）
2. `feat(auth): 密码、验证码与人机验证纯函数`（含单测，RED → GREEN）
3. `feat(auth): 会话签发与 proxy 守卫`
4. `feat(auth): 阿里云邮件推送发信通道`（`.env.example` 只加变量名）
5. `feat(auth): 登录/注册/重置页面与 AI 登录弹窗`

### 阶段 B · workspace 归属收口

范围：`workspace-context.ts` 接线、29 个生产文件替换、队列传递（§5.3）、
迁移脚本（§5.5）、`LOCAL_WORKSPACE_ID` 降级与契约测试。

提交：

6. `refactor(db): 引入 workspace 上下文单一读取口`
7. `refactor(queue): 作业按 attempt 行的 workspace 执行`
8. `refactor(features): 业务查询改用当前 workspace`（机械替换，可拆成 2-3 个提交按 feature 域切）
9. `chore(migration): 既有数据归属到首个注册用户`

### 阶段 C · 文档与门禁核销

提交：

10. `docs(routing): §9 认证守卫按实际实现分层改写`
11. `docs(designs): 登记登录页视觉归属与新增组件`
12. `docs(issues): 登录落地后的生产 issue 复核`（§9 的结论写回 ISSUE-015）

---

## 8. 验证与证据

### 8.1 每次提交前的门禁

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:pg
pnpm verify:v3
pnpm build
git diff --check
```

外加：涉及数据库的提交要把 migration **连续执行两次**；文本变更后对
`AGENTS.md README.md docs src server scripts` 做 U+FFFD 扫描。

`verify:v3` 的 architecture violations 必须保持为空。**新增文件超行要在当前 Task 内
按真实职责拆分，不得写进 baseline。**

### 8.2 必须覆盖的测试（RED → GREEN）

纯函数单测：

- `password.ts`：同一密码两次哈希不同（salt 生效）；正确密码通过；错误密码失败；
  被篡改的哈希串失败。
- `verification-code.ts`：10 分钟边界（过期前一秒有效 / 过期后无效）；一次性消费；
  超过尝试次数作废。
- `human-check.ts`：蜜罐非空即拒；时间戳签名被篡改即拒；早于 1.5s 即拒；晚于 10min 即拒。
- 回跳白名单：`//evil.com`、`http://evil.com`、`javascript:` 全部回落到默认路径。

pg 测试（`*.pg.test.ts`）：

- 注册全链路在**单事务**内创建 user + workspace + member + session；任一步失败全回滚。
- `lower(email)` 唯一：`A@x.com` 与 `a@x.com` 不能注册两次。
- 改密码后旧会话全部失效。
- **跨 workspace 隔离**：A 用户用 B 的 `(projectId, artifactId)` 请求产物 → 404。
- 队列：种入两个不同 workspace 的 `running`/`queued` attempt，确认各自在正确上下文执行、
  互不串号；`query.ts` 的 jobId 查询不能跨 workspace 命中。
- 迁移脚本幂等：连续跑两次只有一条 `workspace_members`。

### 8.3 真实证据（落 `docs/issues/evidence/auth/`）

1. 注册 → 收到真实邮件 → 输入验证码 → 进入 dashboard 的完整 HTTP 序列
   （**验证码值与收件地址在证据里脱敏**）。
2. 验证码 10 分钟过期的真实时间戳对照。
3. 未登录访问 `/products/dashboard` 的 302 响应（含 `next` 参数）。
4. 未登录调 `POST /api/director/pipeline` 的 401 响应。
5. 跨账户产物请求的 404 响应。
6. **登录后画布 SSE 正常**：`GET /api/director/stream/project/{projectId}` 收到
   `node-status` 帧，且空闲 15s 后仍收到 `: keepalive`（证明 cookie 会话没有破坏 EventSource）。
7. 登录页真实 Chromium 截图 + 控制台无错误；`login.png` 优化前后的字节数与 SHA-256。
8. 速率限制触发的 429 响应与 `Retry-After`。

**禁止**把 mock、fixture 或"应该可以工作"的推断当作证据（沿用 ISSUE-014 §4 口径）。

---

## 9. 登录落地后必须再次修复 / 复核的生产 issue

这是本计划的第二个交付物。逐条给出结论与动作。

### 9.1 ISSUE-015 P-2（接入策略）· **需要复核并降级**

- 登录落地**不解除** P-2 的必要性：P-2 还管着 Postgres 端口、worker 暴露面、
  Next 不直连公网这些应用层管不到的事。
- 但边界形态应从 **Basic Auth 降级为纯网络层**（IP allowlist / VPN / mTLS），
  否则用户要过两道认证。该降级**只改反代配置，不动 `src/**`**。
- 动作：更新 `docs/deployment/access.md` 与 ISSUE-015 的 P-2 条目，写明"应用内认证已落地，
  反代层保留为纵深防御"，并重新留一次证据（未登录 → 应用 302/401；反代仍拒绝非白名单来源）。

### 9.2 ISSUE-015 P-4（容器内并发配额）· **需要一起决策，可能改动扩大**

- P-4 原计划是"引入可用 CPU 数的单一读取口（读 cgroup v2 的 `cpu.max`）"。
- 登录引入多 workspace 后多了一个问题：**配额是进程级还是每 workspace 级**（§5.3 第 4 点）。
- 结论建议：**配额是进程级**（约束本机 CPU，与用户无关）。因此 P-4 落地时应同时把
  `queue.laneQuotas` 从 `workspace_settings` 的语义上澄清为进程级配置，
  或明确只读 owner workspace 的值。
- **不要在两处各写一份 CPU 探测逻辑**（P-4 原文禁区）。

### 9.3 ISSUE-015 P-5（孤儿作业回收）· **改动范围扩大，必须重写验收**

- P-5 原方案是"`initQueue()` 时把本 workspace 内仍为 `running` 的 attempt 标记为 failed"。
- 多 workspace 后"本 workspace"不再成立：启动期回收必须**跨全部 workspace**扫描，
  并且每条回收都要在该 attempt 自己的 workspace 上下文里做状态转换
  （`transitionNodeStatus` 的合法路径，不得直接 UPDATE 绕过状态机）。
- 动作：P-5 的验收用例要从"单 workspace 种一条"改成"两个 workspace 各种一条，
  都被正确回收且互不影响"。
- 禁区不变：**不得把 `running` 静默改回 `queued` 自动重试**。

### 9.4 ISSUE-015 P-7（生产 compose）· **需要补 env 与 secret**

新增需要进 compose / secret 的变量：

- `CVC_MAIL_SMTP_HOST` / `CVC_MAIL_SMTP_PORT` / `CVC_MAIL_SMTP_USER` /
  `CVC_MAIL_SMTP_PASS`（**secret**）/ `CVC_MAIL_FROM_ADDRESS` / `CVC_MAIL_FROM_NAME`；
- 若人机验证的时间戳签名使用独立密钥，再加一个 server-only secret（也可复用现有
  master key 的**派生**值，但不得直接用同一 key 做两件事）。

动作：ISSUE-015 P-7 的"`docker compose config` 不含明文 secret"验收项要把新变量纳入检查。

### 9.5 ISSUE-015 P-8（生产端到端验收）· **必须先改脚本，否则全线 401**

- `scripts/verify/e2e-smoke.ts` 无认证能力；且**不能靠 `--base-url https://user:pass@host`
  绕过**（Node fetch 抛 `TypeError: Request cannot be constructed from a URL that includes
  credentials`，已实测）。
- 动作：复用 PLAN-001 §1.6 的同一个凭据出口，扩展为"先调 `/api/auth/login` 拿 cookie，
  后续请求带上"。**只做一个出口。**
- P-8 的验收清单要加一条：**端测使用的账号是真实注册账号，且产物归属该账号的 workspace**。

### 9.6 ISSUE-015 P-9（多实例）· **前置条件增加一项**

- 原前置是"P-5 第二层 lease + heartbeat" + 两个总线换 Redis pub/sub。
- 登录后再加一项：**会话必须跨实例可见**。本计划的 `sessions` 表是 DB 持久化，
  天然跨实例（这是选 DB 会话而非进程内会话的额外收益）。
  但 `auth_throttle` 的固定窗口计数在多实例下会变宽松（每实例各算），需要在 P-9 里
  一并处理或明确接受。
- 动作：在 ISSUE-015 P-9 的"要点"里补这一条。

### 9.7 ISSUE-011（设置页占位与并发数）· **需要复核**

- 该 issue 已 `done`，其结论"配额改动需重启进程才生效，UI 如实标注"仍然有效。
- 但多 workspace 后，设置页展示的 `laneQuotas.source`（`settings` / `env` / `default`）
  语义要跟着 §9.2 的决策调整：如果配额转为进程级，设置页不应再让普通用户修改它，
  否则 UI 可见字段与真值脱钩（AGENTS.md §6）。
- 动作：在 ISSUE-011 文件末尾追加一节"多用户后的复核结论"，不要改写原有已核销内容。

### 9.8 ISSUE-003（Next 侧 AI 凭据）· **需要复核**

- 现有 bootstrap 流程是"把值从 `server/.env` 复制到根 `.env.local` → 跑
  `bootstrap-credentials.ts` → 写入 `provider_credentials` 加密存储"，
  它天然是**单 workspace 冷启动脚本**。
- 多用户后（§5.4 决策为"每用户自带 key"），bootstrap 只服务于首个 owner workspace。
- 动作：在 `docs/configuration/credentials.md` 补一句"bootstrap 只写首个 owner workspace，
  其余用户经设置页自行写入"，并复核脚本里的 workspace 取值来源。

### 9.9 ISSUE-014（端到端验证）· **需要重跑**

- 登录改造触及 13 条既有 API 与队列执行路径，属于链路级改动。
- 动作：登录落地后重跑一轮端测并留新证据，**不得沿用旧证据**。

### 9.10 不受影响、无需动的

| 事项 | 结论 |
| --- | --- |
| ISSUE-015 P-1（保留 error/warn） | 不受影响 |
| ISSUE-015 P-3（成片音轨） | 与认证无关，独立决策 |
| ISSUE-015 §3.3 / §3.4（Chromium、字体、缓存） | 不受影响 |
| `server/**` 全部 issue | 硬边界外，一行不动 |
| 两套 `JobPhase` 合法重复 | 保持，契约测试锁定 |

---

## 10. 禁区

1. **不修改 `server/**`**，不复用其 IMAP 收码链路作为本产品登录（§6）。
2. **不引入 `next-auth`**（§1.3 已说明理由）。
3. **不把会话放进 `Authorization` 头**（打断 EventSource）。
4. **不给 `projects` / `canvas_nodes` / `artifacts` 加 `userId` 列**（§5.2）。
5. **不让 `currentWorkspaceId()` 在无上下文时回落到 `LOCAL_WORKSPACE_ID`**
   —— 静默串号比抛错危险得多。
6. **不区分"账号不存在"与"密码错误"**，不区分"邮箱已注册"与"未注册"（§3.4）。
7. **不把验证码、收件人全量地址、SMTP 口令写进日志、截图、fixture、commit 或对话**。
8. **不创建携带 secret 的 `NEXT_PUBLIC_*`**；客户端不得解析任何 provider / SMTP 凭据。
9. **不为登录页新造 Button / Card / Dialog / 输入框**；新组件必须进 `/playbook` 登记。
10. **不在 `routing.md` §9 里虚报覆盖程度**：哪几条真做了、哪几条是等价替代，
    必须分开写。
11. **不把新超限文件写进 `verify:v3` baseline** 掩盖门禁。
12. **不用 `git reset --hard` / `checkout --` / `--amend` 已推送提交 / `--no-verify`**；
    未经授权不 push、不建 PR。保持在 `yusheng/two-part-merge` 分支。

---

## 11. 交付物清单

代码：

- [ ] `src/lib/db/schema/auth.ts` + migration `0004`（两次幂等验证）
- [ ] `src/features/auth/**`（纯函数 + 仓储 + 邮件通道，全部有单测）
- [ ] `src/lib/auth/{workspace-context,session-cookie}.ts`
- [ ] `proxy.ts`（**不是** `middleware.ts`）
- [ ] `src/app/api/auth/*` 8 条路由
- [ ] 13 条既有 API 的会话解析与上下文包裹
- [ ] `/login`、`/signup`、密码重置页面（左海报 + 右表单，复用 `ui/` 控件）
- [ ] `src/features/auth/login-required-dialog.tsx` + `useRequireLogin()`
- [ ] 4 个客户端 api 模块的 401 归一化
- [ ] 29 个生产文件的 workspace 上下文替换 + 队列传递
- [ ] `scripts/migration/` 的归属迁移脚本（幂等）
- [ ] `scripts/verify/e2e-smoke.ts` 的会话凭据支持（与 PLAN-001 同一出口）
- [ ] `public/img/login.png` 优化（< 400 KB，记录前后大小与 SHA-256）

文档：

- [ ] `docs/conventions/routing.md` §9 分层改写（§9.1 / §9.2 逐行核销 / §9.3 按实覆盖）
- [ ] `docs/designs/Design-system-inventory.md` 登记登录页视觉归属与新增组件
- [ ] `docs/configuration/credentials.md` 补 bootstrap 的 workspace 边界（§9.8）
- [ ] `.env.example` 新增 `CVC_MAIL_*` 变量名（**值留空**）
- [ ] ISSUE-015 的 P-2 / P-4 / P-5 / P-7 / P-8 / P-9 条目按 §9 更新
- [ ] ISSUE-011 / ISSUE-003 / ISSUE-014 追加复核结论
- [ ] `docs/issues/README.md` 索引新增认证 issue 行
- [ ] `docs/issues/evidence/auth/` 八类真实证据

决策待用户拍板（实施前必须已定）：

- [ ] 登录页视觉归属：营销侧（推荐）还是应用侧 `ds-*`（§4.1）
- [ ] 邮件通道：SMTP + `nodemailer`（推荐）还是 DirectMail HTTP API（需新凭据）（§1.5）
- [ ] provider 凭据语义：每用户自带 key（推荐）还是平台统一 key（§5.4）
- [ ] 并发配额语义：进程级（推荐）还是每 workspace 级（§5.3 / §9.2）
- [ ] 落地页 `LaunchComposer`（worker 演示）是否也要求登录（§4.4）
