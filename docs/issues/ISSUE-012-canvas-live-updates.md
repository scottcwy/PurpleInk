# ISSUE-012 · 画布靠 1.5s `router.refresh()` 轮询驱动状态

- 优先级：**P2**（体验与成本，非阻断）
- 状态：`open`
- 范围：`canvas/[projectId]/canvas-view.tsx`、`src/lib/stream/**`、可能新增一条 SSE 端点
- 依赖：建议在 ISSUE-001 + ISSUE-002 之后（先有真实运行的节点，才能验证推送）
- 性质：需要先决策实现方式

## 1. 症状

画布节点状态靠整页轮询刷新，不是推送：

`src/app/products/(app)/canvas/[projectId]/canvas-view.tsx:90-94`——
只要有节点处于 `pending` 或 `running`，就每 1.5 秒调一次 `router.refresh()`。

`router.refresh()` 会重新执行整个 Server Component 树，
即 `page.tsx` 的 `getCanvasGraph()` + `computeLayout()` 全量重跑
（`page.tsx:25-34`），每 1.5 秒一次，直到全部节点终态。

## 2. 影响

一个含 6 条泳道的项目有 4 + 6×5 = **34 个节点**。跑完整条链路可能持续数分钟，
期间每 1.5 秒：

- 一次完整的 canvas 图查询（节点 + 边 + 每节点 artifacts）；
- 一次 dagre 全量布局重算；
- 一次 React Server Component 渲染 + 序列化 + 客户端 reconcile。

同时轮询与真实推送**并存**：阶段日志已经有 SSE
（`/api/director/stream/[nodeId]`，由 `src/lib/hooks/use-stage-stream.ts` 消费），
所以「日志是推的、状态是拉的」，两套机制描述同一件事。

## 3. 现有基础设施

`src/lib/stream/stream-bus.ts`（160 行）已经具备：

- `publish(key, delta)` / `markDone(key)` / `markError(key, error)`；
- `subscribe(key, listener)` 带快照回放（新订阅者能拿到已发生的内容）；
- 有界缓冲 `MAX_BUFFER_CHARS = 256KB`；
- 最后一个订阅者断开后 30 秒清理；
- 锚定在 `globalThis` 以抵抗 Next.js HMR。

`/api/director/stream/[nodeId]/route.ts`（143 行）已经实现了完整的 SSE 服务端：
活跃时订阅 bus，已终态时回放持久化日志，15 秒 keepalive，
并处理了 split-brain（快照为空时合并落盘日志）。

**已知限制**（已在代码注释登记，不在本 issue 范围）：
stream-bus 仅进程内，不跨进程；多实例部署需换 Redis pub/sub。

## 4. 需要先做的决策

### 方案 A：新增「项目级状态流」SSE（推荐）

新增 `GET /api/director/stream/project/[projectId]`（或类似形状），
推送**节点状态变更事件**而非文本增量：

```text
event: node-status
data: { nodeId, status, revision }
```

发布点在 `transitionNodeStatus`（`src/features/canvas/status.ts:39-77`）——
它已经是所有状态迁移的唯一入口，是天然的发布点。

客户端收到事件后做**局部更新**（只改该节点的 status），
仅在拓扑变化（扇出新增节点/边）时才 `router.refresh()`。

**必须先改 `docs/conventions/routing.md` §4.1 登记这条新端点**，再写代码。
同时注意 §4.3 的资源 URL 合同表也要补一行。

代价：`transitionNodeStatus` 位于 `features/canvas`，
而 `verify:v3` 的 `CANVAS_FORBIDDEN_IMPORT` 禁止 canvas 层 import
`drizzle-orm` 之外的一批东西——`src/lib/stream` **不在禁止列表内**，
所以从 canvas 层 publish 到 stream-bus 是允许的。实现前用 `pnpm verify:v3` 确认。

### 方案 B：保留轮询但降低成本

把状态查询从 `router.refresh()` 换成一个轻量 JSON 端点
（只返回 `nodeId → status` 映射），客户端局部更新，
不再触发 Server Component 全量重渲与 dagre 重算。
轮询间隔可退避（1.5s → 3s → 5s）。

比方案 A 简单得多，消除了绝大部分成本，但仍有固定延迟与空轮询。

### 方案 C：不动

只有在确认 34 节点规模下轮询开销可接受时才成立。
**需要先测量**：记录一次完整链路运行期间 `getCanvasGraph()` 的调用次数与累计耗时。
若不测量就选 C，等于没有决策。

## 5. 决策前必须做的测量

跑一次含 >= 4 条泳道的完整链路，记录：

1. `router.refresh()` 触发次数；
2. `getCanvasGraph()` 的 SQL 次数与 P95 耗时；
3. 状态从 DB 变更到 UI 可见的实际延迟；
4. 浏览器主线程在轮询期间的占用。

把数据写进本文件，再选方案。

## 6. 修复范围（方案 A）

| 文件 | 动作 |
| --- | --- |
| `docs/conventions/routing.md` | **先**登记新端点（§4.1 + §4.3） |
| `src/app/api/director/stream/project/[projectId]/route.ts` | 新增 SSE 端点 |
| `src/features/canvas/status.ts` | `transitionNodeStatus` 成功后发布状态事件 |
| `src/lib/stream/stream-bus.ts` | 若需要结构化事件（非纯文本 delta），扩展事件类型 |
| `src/lib/hooks/use-*.ts` | 新增项目级状态订阅 hook（参考 `use-stage-stream.ts`） |
| `canvas-view.tsx` | 局部更新状态；拓扑变化时才 `router.refresh()` |
| 对应 `.test.ts` | 覆盖：状态事件发布、订阅回放、断线重连、终态后关闭 |

## 7. 禁区

1. 不删除 `/api/director/stream/[nodeId]` 的文本流——两者职责不同（状态 vs 日志）。
2. 不因为有了推送就移除**兜底**：网络中断或 SSE 不可用时必须能退回轮询，
   否则用户会看到永久停在 `running` 的节点。
3. 不用假进度百分比填充节点（AGENTS.md §6 禁止固定假百分比）。
   节点只有离散状态，没有百分比。
4. 不引入永久 Skeleton。
5. 不让状态只靠颜色表达——必须同时有文本或图标语义（AGENTS.md §6）。
6. 不动 `server/**`（worker 的 job 进度是另一套，见 `README.md` §0）。
7. 不为跨进程推送引入 Redis——那是已登记的后置项，超出本 issue。

## 8. 验收标准

1. 本文件已记录 §5 的测量数据与选定方案。
2. 若涉及新端点：`docs/conventions/routing.md` §4.1 与 §4.3 已先行更新。
3. `pnpm test` 全绿，含断线重连与终态关闭用例。
4. `pnpm typecheck`、`pnpm build` 通过；`pnpm verify:v3` 违规数不增加，
   `canvasForbiddenImports` 仍为空。
5. **真实证据**：跑一次含 >= 4 条泳道的完整链路：
   - 状态变更到 UI 可见的延迟 < 1s；
   - 整个运行期间 `getCanvasGraph()` 调用次数**显著低于**修复前（附前后对比数据）；
   - 手动断开 SSE（关闭端点或断网）后，UI 能退回兜底路径并最终收敛到正确终态；
   - 扇出新增节点时画布能正确显示新泳道。
   留档到 `docs/issues/evidence/issue-012/`（含前后对比数据与截图）。
