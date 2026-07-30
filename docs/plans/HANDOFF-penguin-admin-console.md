# HANDOFF · penguin 分支管理后台交接（面向合并者）

- 分支：`penguin`
- 交接日期：2026-08（管理后台 v1 四模块 + v2 三模块落地后）
- 合并基线：`origin/penguin`（较旧，本分支领先若干提交）
- 目的：让其他分支把 penguin 的管理后台代码合并进来时，知道**哪些共享文件是冲突热点、迁移如何对齐、合并后如何自检**。
- 上游真值（遇冲突以其为准）：`docs/conventions/routing.md` §9 守卫矩阵、`docs/designs/Design-system-inventory.md` §9 图标白名单。

## 1. 本分支交付了什么

一套 `/admin` 管理后台，全部走 `withAdminSession` 守卫、Drizzle 迁移、`ds-*` 设计令牌与现有 UI 原语（Card/Button/StatusPill/Dialog/SegmentedControl），图表用 SVG 自绘，不引第三方库。

- **v1（四模块）**：概览/DAU（`/admin`）、账号管理（`/admin/users`）、任务监控（`/admin/jobs`）、系统运维（`/admin/ops`）。
- **v2（三模块）**：
  - 安全监控 + 接口访问统计 `/admin/security`：新表 `api_access_counters`（1 分钟固定窗口计数）+ `auth_throttle` 限流/攻击信号聚合。
  - 订阅计费管理 `/admin/billing`：套餐分布 + 兑换码批次生成/撤销（明文码仅显示一次、只存哈希）。
  - AI 调用审计 `/admin/ai`：跨 workspace 只读聚合 `ai_invocations`（调用量/成功率/成本/失败分布/top models）。

## 2. 合并冲突热点（重点先看）

以下共享文件被本分支修改，其他分支很可能也动过，合并时**逐一核对**：

| 文件 | 本分支改动 | 合并要点 |
| --- | --- | --- |
| `src/lib/db/schema/index.ts` | 新增 `export * from './observability'` | 保留双方所有 export，去重即可 |
| `src/lib/db/schema/observability.ts` | 新文件：`api_access_counters` 表 | 新增文件，一般无冲突 |
| `src/features/auth/api-session.ts` | `withApiSession` 增加 `options.routeGroup`，出口对 status 归类做 fire-and-forget 计数 | 见 §3，别丢掉出口计数两行 |
| `src/app/admin/admin-nav.tsx` | `NAV_ITEMS` 增加 security/billing/ai 三项 + 图标 import | 合并数组，保留双方新增项 |
| `docs/designs/Design-system-inventory.md` §9 | 图标白名单补入 `wallet`（admin 计费用） | 合并白名单列表 |
| 迁移目录 `src/lib/db/migrations/pg` | 见 §4 | **最易出问题，务必按 §4 处理** |

此外，A1 埋点为多条业务 API 路由补了 `routeGroup`（`ai-usage`、`director/pipeline`、`projects`、`projects/[id]/start`、`render/export` 及全部 `/api/admin/*`）。这些只是在 `withApiSession(handler, { routeGroup })` 尾参加了一个稳定分组名，合并时保留该参数即可，不影响原有逻辑。

## 3. api-session.ts 埋点机制（合并时别改坏）

`withApiSession` 的出口计数是安全监控页的数据源，逻辑很轻：

- 传 `options.routeGroup`（不含 id/query 的稳定分组名）时，无论 401 还是 handler 正常返回，都在出口对 `response.status` 归类后 `void recordApiAccess(routeGroup, status)`。
- `recordApiAccess` 是 fire-and-forget，内部吞掉所有错误，**绝不阻塞/影响响应**。
- 归类口径（`classifyOutcome`）：401/404 独立成类，>=500 归 `5xx`，其余 4xx 归 `4xx`，2xx/3xx 归 `2xx`。

合并时只要保证「401 分支」和「handler 返回分支」两处出口计数都在即可。

## 4. 数据库迁移对齐（最关键）

本分支迁移推进到 **0020**（`0020_amazing_shinobi_shaw.sql`，新增 `api_access_counters`；0019 为 v1 admin 的 `render_jobs` 等）。合并时：

1. 若目标分支也有自己的 0019/0020 编号，**会与本分支撞号**。先合并 schema 源码（`src/lib/db/schema/*`），解决 `index.ts`、`observability.ts` 冲突。
2. 迁移的 `meta/_journal.json` 和 `*_snapshot.json` 二进制式内容不要手工拼。撞号时删掉本分支多余编号的 sql/snapshot，**用 `pnpm db:generate` 基于合并后的 schema 重新生成增量迁移**，让编号顺延到目标分支之后。
3. `src/lib/db/schema-metadata.pg.test.ts` 已登记 `api_access_counters`（TABLES / 主键 `bucket_started_at,route_group,outcome` / outcome check / count>=0 check）；重生成迁移后跑该契约测试确认元数据一致。
4. 应用迁移：`pnpm db:migrate`。

## 5. 新增文件清单

- Service：`src/features/admin/{access-log,security,billing-admin,ai-audit}.ts`
- 页面：`src/app/admin/{security,billing,ai}/{page.tsx,*-client.tsx}`
- API：`src/app/api/admin/{security,ai}/route.ts`、`src/app/api/admin/billing/route.ts` + `billing/batches/route.ts`（POST 建批次）+ `billing/batches/[id]/route.ts`（PATCH 撤销）
- Schema/迁移：`src/lib/db/schema/observability.ts`、`0020_amazing_shinobi_shaw.sql`
- 兑换码 service：`src/features/billing/redemption.ts` 增 `createRedemptionBatch` / `revokeRedemptionBatch`（`billing/index.ts` 已导出）
- 测试：`src/features/admin/security.test.ts`（单元）、`src/features/admin/admin-v2.pg.test.ts`（pg）

## 6. 合并后自检

```
pnpm typecheck && pnpm lint && pnpm test && pnpm test:pg
```

四项应全绿。手工验收：admin 登录后七页可达；制造若干 401/404 与登录失败后 `/admin/security` 有数；建兑换码批次 → 明文码 → 普通账号 redeem 成功 → 撤销后失败；`/admin/ai` 显示既有 `ai_invocations` 聚合。

## 7. 已知问题 / 边界

- `src/features/ai/workspace-concurrency.pg.test.ts` 有一个 p95<20ms 的时序敏感断言，在慢机器上偶发红（实测 ~20.9ms），**单独重跑即过**，与本分支改动无关。
- 接口访问统计是 1 分钟固定窗口聚合（同 `auth_throttle` 取舍），多副本下每副本各计一份、整体偏宽松——够看趋势与异常放量，非计费依据。
- 兑换码明文不入库、不可找回，撤销以批次为粒度；`REDEEMABLE_PLAN_KEYS = ['plus','pro','max']`（free 不可兑换）。
- AI 审计为跨 workspace 只读聚合，不展示单 workspace 明细 PII。
- TTS 密钥问题不在本轮范围。
