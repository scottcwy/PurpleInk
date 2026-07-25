# ISSUE-008 · dagre 每次重算布局，覆盖已持久化坐标

- 优先级：**P2**
- 状态：`done`
- 范围：`src/features/canvas/layout.ts`、`canvas/[projectId]/page.tsx`、`canvas-view.tsx`
- 依赖：无（但建议在 ISSUE-007 之后，避免同时讨论两套画布）
- 性质：真值冲突，需要先定「坐标的唯一真值是谁」

## 1. 症状

节点坐标有两个来源，且互相矛盾：

- DB 里有 `canvas_nodes.position_x` / `position_y`（`double precision`，写入于建项目与扇出时）；
- 页面每次加载又用 dagre **重新计算**并覆盖显示位置。

同时 `nodesDraggable={false}`（`canvas-view.tsx:114`），用户根本无法拖动。

结果：持久化的坐标列**从未被真正消费**，而写它们的代码仍在维护成本内。

## 2. 证据

### 2.1 建项目时写死坐标

`src/features/canvas/actions.ts:62-76`

```ts
const nodes = GLOBAL_NODE_DEFINITIONS.map((definition, index) => ({
  ...
  positionX: index * 260,
  positionY: 80,
  ...
}))
```

### 2.2 页面加载时重算

`src/app/products/(app)/canvas/[projectId]/page.tsx:30-34` 调用 `computeLayout()`。

`src/features/canvas/layout.ts:32-68` 用 dagre：

```ts
rankdir: 'LR'
ranksep: 100
nodesep: 80
固定节点尺寸 220 x 100
```

全局节点被压到 `Y=0`（`layout.ts:82`），泳道按 `LANE_GAP = 80` 纵向堆叠（`layout.ts:86`）。

### 2.3 用户不能拖

`canvas-view.tsx:114` `nodesDraggable={false}`，且没有任何 `onNodesChange` 持久化回写。

## 3. 需要先做的决策

坐标只能有一个真值。三条路：

### 方案 A：布局是纯派生，删除持久化坐标（推荐）

坐标完全由 DAG 结构派生，`canvas_nodes.position_x/y` 列不再写也不再读。

优点：单一真值，扇出后新增泳道自动排好，不会出现「节点重叠」或「新节点跑到画布外」。
符合当前 `nodesDraggable={false}` 的实际交互。

要处理：
- 列要不要删？删列需要 migration，且 `share snapshot`（routing.md §8.3）
  白名单里提到「画布图的固定版本（节点、连线、节点类型）」——**坐标不在白名单内**，
  所以删列不影响分享快照。
- 若不删列（保守），必须在 schema 注释与 `docs/conventions/` 里写明「该列已废弃、不得消费」，
  并停止写入，否则下一个人又会以为它有效。

### 方案 B：坐标是真值，dagre 只用于「自动布局」按钮

需要同时做三件事，否则不自洽：
1. `nodesDraggable={true}`；
2. 拖动后回写坐标（需要新 API，routing.md §4.1 要登记）；
3. dagre 降级为显式动作（一个「自动布局」按钮），不在加载时执行。

成本明显更高，且当前设计稿（`docs/designs/canvas.pen`）是否有拖动交互**需要先核实**。

### 方案 C：混合（新节点用 dagre，已有节点用持久化坐标）

**不推荐。** 这是最容易产生「节点重叠」与「布局抖动」的方案，且真值仍然是两个。

## 4. 决策前必须核实

1. `docs/designs/canvas.pen` 与 `docs/designs/Design-system-inventory.md` 的 S3 屏
   是否规定了节点可拖动 / 是否有「自动布局」控件。**设计稿是像素真值，它说了算。**
2. `src/lib/db/schema/canvas.ts` 里 `position_x/y` 是否 `notNull`——影响能否停止写入。
3. `share snapshot` 与 `docs/conventions/routing.md` §8.3 是否引用坐标（初查：**未引用**）。

## 5. 决策记录（2026-07-25）

**选定方案：A2（彻底删列）。** 三项核实结论：

1. **设计稿**：当前环境未连接运行中的 Pencil 实例，无法直接读取 `canvas.pen` 原始像素。退而查
   `AGENTS.md:80` 明确登记为 `canvas.pen` 文字索引的 `docs/designs/Design-system-inventory.md`：
   S3（`/canvas/[projectId]`）§7 主操作只有 `Run ready nodes`；C2 Pipeline 模块（§6）只登记
   `PipelineNode`、`QueueBar`；全文搜索"拖 / drag / 自动布局"零匹配。结论：设计稿未规定节点可拖动
   或有自动布局控件，方案 B 不成立。
2. **`position_x/y` 是否 `notNull`**：确认 `src/lib/db/schema/canvas.ts:60-61` 是
   `doublePrecision(...).notNull()` 且无 DB default。这意味着本节原先设想的"不删列（保守）+
   停止写入"实际不可执行——NOT NULL 无 default 的列不能不写值。因此"保留列"分支的唯一可行形态是
   继续写占位常量（不再是伪装成真实布局的 `index * 260`），成本与"删列"相当但会永久保留两列死数据，
   故选择彻底删列。
3. **share snapshot 白名单**：确认 `docs/conventions/routing.md` §8.3 白名单只写"画布图的固定版本
   （节点、连线、节点类型）"，未提坐标，删列不影响分享快照。

**额外修正**：本文件 §2.3 引用的 `canvas-view.tsx:114` `nodesDraggable={false}` 是**过时证据**——
`git log -p -S nodesDraggable` 显示这行属于已被 ISSUE-007（commit `cfcc52a`）删除的
`src/features/workflow/workflow-canvas.tsx`（重复画布实现），不是现生产用的
`src/app/products/(app)/canvas/[projectId]/canvas-view.tsx`。现生产代码的 `<ReactFlow>`
**没有设置** `nodesDraggable`，默认值为 `true`：节点表面可拖动，但因 `nodes` 是服务端下发的受控数组、
未接 `onNodesChange` 回写，下一次父组件重渲染（`canvas-view.tsx` 中只要有 pending/running
节点即每 1.5s 触发一次的 `router.refresh()` 轮询）就会把拖动结果弹回原位——这比"硬禁用"更容易造成
用户困惑，一并作为选择方案 A 而非 B 的理由。

**死代码范围核实**：`getCanvasGraph()` 全仓库有 11 处调用方，但读取返回值 `.position` 字段的只有
`canvas/[projectId]/page.tsx` 与其下游 `flow-elements.tsx`；而 `page.tsx` 里
`positions.get(node.id) ?? node.position` 的 `??` 右侧因 `computeLayout` 对入参每个节点必返回一条
坐标记录而永不可达。`canvas_nodes.position_x/y` 在当前代码库中没有任何一条路径被真正读取消费。

## 6. 修复范围（方案 A2）

| 文件 | 动作 |
| --- | --- |
| `src/features/canvas/actions.ts` | 删除 `positionX`/`positionY` 写入 |
| `src/features/canvas/fan-out.ts` | 同上 |
| `src/lib/db/schema/canvas.ts` | 删除 `positionX`/`positionY` 列定义 |
| `src/lib/db/migrations/pg/` | 新增 `ALTER TABLE ... DROP COLUMN` migration，并**连续执行两次**验证幂等（AGENTS.md §8） |
| `src/features/canvas/queries.ts` | 不再 select 坐标；`CanvasGraphNode` 移除 `position` 字段 |
| `src/features/canvas/layout.ts` | 保持为唯一坐标来源；补注释说明这是派生值 |
| `src/features/canvas/layout.test.ts` | 覆盖：多泳道不重叠；新增泳道后既有泳道不位移 |
| `src/lib/db/integration/canvas-*.pg.test.ts`、`schema.pg.test.ts`、`render.pg-fixture.ts` 等 | 同步 fixture，移除 `positionX`/`positionY` |
| `canvas/[projectId]/page.tsx`、`flow-elements.tsx` | 类型联动：渲染层节点需在 `CanvasGraphNode` 基础上叠加 `computeLayout` 输出的 `position` |

## 7. 禁区

1. 不在同一轮里既保留持久化坐标又保留加载时重算——那就是没修。
2. 不在没核实设计稿的情况下开启拖动。
3. 不因为「布局不好看」就在 `layout.ts` 里塞特例分支；节点尺寸/间距应是常量而非按类型 hack。
4. 删列必须走 migration，不得手改数据库。
5. 不动 `server/**`。

## 8. 验收标准

1. 本文件已记录选定方案、设计稿核实结论（引用具体屏号/条目）。
2. `pnpm test`、`pnpm test:pg`、`pnpm typecheck` 全绿；`pnpm verify:v3` 违规数不增加。
3. 若涉及 migration：`pnpm db:migrate` 连续执行两次均成功且结果一致。
4. 全仓库只有一处决定坐标：grep `positionX`、`position_x`、`computeLayout` 的结果自洽。
5. **真实截图证据**：一个含 **>= 4 条泳道**的项目，画布页 Chromium 截图，
   节点无重叠、无溢出可视区、连线无交叉错乱；控制台无报错。
   刷新页面两次，布局**完全一致**（无抖动）。
   证据留档到 `docs/issues/evidence/issue-008/`。

## 9. 修复记录（2026-07-25）

### 9.1 隔离说明

修复期间检测到仓库内有另一并发会话正在实时修改 `src/features/audio/**`、
`src/features/director/**`、`src/features/render/**`（ISSUE-005 相关，且已产生提交
`171f692`）。为避免互相干扰，本次修复在独立 git worktree
（`issue-008-canvas-layout-truth` 分支，基于当时 HEAD `171f692`）与独立 Postgres
容器（`issue008-postgres`，端口 `54329`，与共享的 `purpleink-dev-postgres-1` 完全隔离）
中完成。**因此 §9.2 表格里的验证结果不包含之后陆续落地的 ISSUE-005/011 改动**，
详见 §9.5 合并说明。

### 9.2 验证结果

| 命令/项 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 102 files / 449 passed / 3 failed，exit 1。3 个失败均在 `tests/job-phase-contract.test.ts`，与本 issue 无关：该测试用正则解析 `server/src/server/job-store.ts` 的 `JobPhase` 联合类型，已确认在本次改动之前（分支基点 `171f692`）即失败，不属于 `docs/issues/` 范围（`server/**`），未修复。 |
| `pnpm verify:v3` | `"ok": true, "violations": []`，未新增任何违规 |
| `pnpm test:pg`（隔离 Postgres） | 15 files / 76 passed / 1 failed。失败项 `runtime-repository.pg.test.ts > assembles score input...` 是 ISSUE-005 未完成的 `audioManifest`/`audioAllocation` schema 迁移遗留，继承自分支基点，与坐标改动无关。**画布相关的 5 个 pg 测试文件单独重跑：27/27 全绿**（`canvas-fan-out`、`canvas-queries`、`canvas-status`、`schema.pg.test.ts`、`render/repository.pg.test.ts`）。 |
| `pnpm db:migrate` 双跑 | 第一次应用 `0003_drop_canvas_node_position.sql`（`DROP COLUMN position_x/position_y`）；第二次幂等跳过，`\d canvas_nodes` 确认两列已不存在，其余 9 列/索引/约束不变。 |
| grep `positionX`/`position_x`/`position_y` | 全仓库零命中（仅历史 migration `0000`/`0001` 保留，属不可变历史）。 |
| grep `computeLayout` | 生产代码仅 `page.tsx:31` 一处调用，`layout.ts` 是唯一实现。 |

### 9.3 截图证据

用真实生产代码路径（`createProject` + `materializeShotLanes`，非伪造数据）在隔离
Postgres 中物化一个 **5 条泳道**（S001–S005，29 个节点）的项目，Playwright/Chromium
1600×1000 视口截图：

| 文件 | 说明 |
| --- | --- |
| `evidence/issue-008/canvas-5-lanes-load-1.png` | 首次加载 |
| `evidence/issue-008/canvas-5-lanes-load-2.png` | 第一次刷新 |
| `evidence/issue-008/canvas-5-lanes-load-3.png` | 第二次刷新 |

自动化比对结果：29 个节点三次加载的 DOM 坐标（`transform` + `getBoundingClientRect`）
逐节点**完全一致**；`page.on('console'/'pageerror')` 全程**零报错**；视觉核对 5 条泳道
横向分层、无节点重叠、连线无交叉错乱、全部节点在视口内。

### 9.4 结论

验收标准 1–5 全部满足（标准 2 的 `pnpm test`/`pnpm test:pg` 中的失败项已逐一核实为
继承自并发分支基点、与本 issue 无关，非本次改动引入）。状态转 `done`。

### 9.5 合并说明（rebase 到 master）

提交后 `master` 已推进到 `0c89855`（新增 ISSUE-005 done、ISSUE-011 的
`workspace_settings` 表 + `0002_workspace_settings.sql` migration）。
把 `issue-008-canvas-layout-truth` rebase 到该 commit 时处理了两处真实冲突：

1. `docs/issues/README.md`：git 3-way 自动合并成功（两边改动相邻但不重叠）。
2. migration 序号撞车：对方已用掉 `0002`。解决方式——保留对方
   `0002_workspace_settings.sql` / `meta/0002_snapshot.json` 不变，
   本 issue 的坐标列删除改发 `0003_drop_canvas_node_position.sql`
   （journal `idx: 3`）。

**额外发现（超出 ISSUE-008 范围，仅记录不处理）**：`pnpm db:generate` 对
`meta/0002_snapshot.json` 报 `data is malformed`（Zod 校验失败，具体字段未深挖）；
已确认在 `master` 本身（未叠加本 issue 任何改动）即可复现，与坐标改动无关，
不是本次改动引入。规避方式：手工基于该快照派生 `0003_snapshot.json`
（原样复制 + 摘掉 `position_x`/`position_y` 两个列条目 + 更新
`id`/`prevId`），不依赖 `drizzle-kit generate` 的自动 diff。`pnpm db:migrate`
走的是运行时 migrator（只读 `.sql` + `_journal.json`），不经过这条校验路径，
双跑验证见下表。

rebase 后重新跑过一遍完整验证（隔离 Postgres 已清空重建，验证完整链路
`0000→0001→0002→0003`）：

| 命令/项 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm verify:v3` | `ok: true`，0 违规 |
| `pnpm test` | 102 files / 458 passed / 3 failed，同 §9.2 的 `job-phase-contract.test.ts`（`server/**`，无关，未修） |
| `pnpm db:migrate` 双跑（清空重建后） | 两次均成功；`\d canvas_nodes` 确认两列已删除且不受 `workspace_settings` 影响；`\d workspace_settings` 确认该表结构完整 |
| `pnpm test:pg` | 16 files / 80 passed / 4 failed。1 个同 §9.2（ISSUE-005 遗留，无关）；新增 3 个在 `schema-metadata.pg.test.ts`（硬编码 `toHaveLength(23)` 表/FK/UUID 计数断言，因 `workspace_settings` 新表未同步更新，已确认 `master` 本身即失败，属 ISSUE-011 收尾遗留，非本 issue 引入，未修）。**画布相关 5 个 pg 文件单独重跑：27/27 全绿，与 rebase 前一致**。 |

结论不变：ISSUE-008 范围内改动全部验证通过；rebase 后暴露的 4 项新失败均已逐一
核实为与本 issue 无关的既有问题，据实记录、不在本 issue 内修复。
