# ISSUE-008 · dagre 每次重算布局，覆盖已持久化坐标

- 优先级：**P2**
- 状态：`open`
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

## 5. 修复范围（方案 A）

| 文件 | 动作 |
| --- | --- |
| `src/features/canvas/actions.ts` | 停止写入硬编码坐标（或保留 0/0 直到列被删） |
| `src/features/canvas/fan-out.ts` | 同上 |
| `src/lib/db/schema/canvas.ts` | 若删列则改 schema + 新增 migration；否则加废弃注释 |
| `src/lib/db/migrations/pg/` | 若删列，新增 migration，并**连续执行两次**验证幂等（AGENTS.md §8） |
| `src/features/canvas/queries.ts` | 不再 select 坐标 |
| `src/features/canvas/layout.ts` | 保持为唯一坐标来源；补注释说明这是派生值 |
| `src/features/canvas/layout.test.ts` | 覆盖：多泳道不重叠；新增泳道后既有泳道不位移 |
| `src/lib/db/integration/canvas-*.pg.test.ts` | 同步 fixture |

## 6. 禁区

1. 不在同一轮里既保留持久化坐标又保留加载时重算——那就是没修。
2. 不在没核实设计稿的情况下开启拖动。
3. 不因为「布局不好看」就在 `layout.ts` 里塞特例分支；节点尺寸/间距应是常量而非按类型 hack。
4. 删列必须走 migration，不得手改数据库。
5. 不动 `server/**`。

## 7. 验收标准

1. 本文件已记录选定方案、设计稿核实结论（引用具体屏号/条目）。
2. `pnpm test`、`pnpm test:pg`、`pnpm typecheck` 全绿；`pnpm verify:v3` 违规数不增加。
3. 若涉及 migration：`pnpm db:migrate` 连续执行两次均成功且结果一致。
4. 全仓库只有一处决定坐标：grep `positionX`、`position_x`、`computeLayout` 的结果自洽。
5. **真实截图证据**：一个含 **>= 4 条泳道**的项目，画布页 Chromium 截图，
   节点无重叠、无溢出可视区、连线无交叉错乱；控制台无报错。
   刷新页面两次，布局**完全一致**（无抖动）。
   证据留档到 `docs/issues/evidence/issue-008/`。
