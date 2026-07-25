# ISSUE-007 · 两套画布实现并存（`WorkflowCanvas` vs `CanvasView`）

- 优先级：**P2**
- 状态：`open`
- 范围：`src/features/workflow/**`、`src/app/playbook/registry.ts`
- 依赖：无。**可第一批并行**，与 P0 三条文件零重叠
- 性质：需要先决策（保留为组件登记样例 / 删除），再动手

## 1. 症状

`@xyflow/react` 画布有两个实现，用两套不同的节点状态枚举、两套数据来源、两套节点组件。

| | `WorkflowCanvas` | `CanvasView` |
| --- | --- | --- |
| 文件 | `src/features/workflow/workflow-canvas.tsx`（138 行） | `src/app/products/(app)/canvas/[projectId]/canvas-view.tsx`（228 行） |
| 数据 | 硬编码 `STAGE_B_WORKFLOW_NODES`（`blueprint-model.ts`） | 真实 DB（`getCanvasGraph()`） |
| 节点组件 | `src/components/ui/pipeline-node.tsx` | `flow-elements.tsx` 内联 + `components/ui/node/**` |
| 状态枚举 | `PipelineNodeStatus`：`unwired / ready / running / completed / blocked` | `NodeStatus`：`idle / pending / running / success / failed / cancelled / stale` |
| 挂载点 | 仅 `/playbook/patterns` | `/products/canvas/[projectId]` |
| 交互 | 两个按钮 **disabled**，文案「将在 Stage B 接线」 | 真实接 `/api/director/pipeline`、`/api/director/stage`、`/api/render` |

## 2. 证据

`src/features/workflow/workflow-canvas.tsx:79-96`——两个按钮是死的，
且是**裸 `<button>`**，没有复用已登记的 `Button` 组件（这本身就违反 AGENTS.md §3
「页面不得本地拼装平行的 Button / Card / Badge / Sidebar / Tabs」）：

```tsx
<button type="button" disabled title="自动布局将在 Stage B 接线" ...>自动布局</button>
<button type="button" disabled title="运行能力将在 Stage B 接线" ...>运行工作流</button>
```

`workflow-canvas.tsx:99-101` 还有一条横幅文案：

```tsx
结构预览：节点尚未接入 ProductFlowVersion、FlowNode 或 Artifact。
```

`ProductFlowVersion` 与 `FlowNode` 是 **routing.md §12 已宣告作废的 Release 六步模型实体**，
在 `src/lib/db/schema/**` 中根本不存在。这条文案在向用户承诺一个已被废弃的数据模型。

`docs/conventions/routing.md:363` 已经登记了这个状态：

> `WorkflowCanvas` 的唯一挂载点转为 `/playbook/patterns`。

`src/app/playbook/registry.ts:236-240` 注册了它作为 `patterns` 分类的唯一一项。

`blueprint-model.ts:71` 行内含 `STAGE_B_WORKFLOW_NODES` 与 `CANONICAL_WORKFLOW_NODES` 两组硬编码 fixture。

## 3. AGENTS.md 的相关约束

> 应用壳只有一套。禁止出现第二个 shell、第二个 sidebar 或第二套 pathname 到高亮的映射。
> 跨域复用现有公开导出；不要为同一职责增加平行 wrapper、第二套状态模型或纯 re-export 壳。

`WorkflowCanvas` 是**第二套状态模型**（`PipelineNodeStatus`）。
它当前没有造成运行时冲突（只挂在 playbook），但：

- 新人改画布时有 50% 概率改错文件；
- 两套状态枚举意味着任何状态语义变更都要改两处，且没有测试锁住一致性；
- `PipelineNode`（`components/ui/pipeline-node.tsx`，74 行）与
  `components/ui/node/{stage-node,shot-node,audio-node,export-node}.tsx` 也是两套节点视觉。

## 4. 需要先做的决策

### 方案 A：删除 `src/features/workflow/**`（推荐）

`/playbook/patterns` 的「组件登记」价值可以由真实画布的子组件提供
（`components/ui/node/**` 已经各有 `.demo.tsx`，本来就在 `/playbook/ui` 登记）。
`patterns` 分类若因此为空，需按 routing.md §2.4 的口径处理
（要么补进别的 pattern，要么在索引页标注该分类暂无登记项）。

成本：删 3 个文件、改 `playbook/registry.ts`、确认 `registry.test.ts` 与
`tests/cvc-ui-smoke.test.tsx`、`tests/app-route-contract.test.tsx` 仍绿。

### 方案 B：保留，但收敛状态模型

让 `WorkflowCanvas` 复用 `NodeStatus`（`src/features/canvas/types.ts`）而非自有枚举，
并在文件头明确标注「这是设计登记样例，不是生产画布，不得接真实数据」。
同时删掉两个 disabled 按钮——routing.md §5 第 7 条禁止「可点击但无行为的导航项」，
disabled 按钮虽不可点，但「将在 Stage B 接线」是对未来的承诺，属于占位噪音。

### 方案 C：不动

只有在设计侧明确要求 `/playbook/patterns` 保留这个整图样例时才成立。
需要 `docs/designs/Design-system-inventory.md` 有对应登记条目作为依据——
**先去核实有没有**，有则记录条目号，无则不选此方案。

## 5. 修复范围（方案 A）

| 文件 | 动作 |
| --- | --- |
| `src/features/workflow/workflow-canvas.tsx` | 删除 |
| `src/features/workflow/workflow-canvas.demo.tsx` | 删除 |
| `src/features/workflow/blueprint-model.ts` | 删除（先确认无其他引用） |
| `src/app/playbook/registry.ts` | 移除 `patterns` 注册项；按需调整分类口径 |
| `src/app/playbook/patterns/page.tsx` | 按分类是否为空调整 |
| `src/components/ui/pipeline-node.tsx` + `.demo.tsx` | 若仅被 `WorkflowCanvas` 使用则一并删除；**先 grep 确认** |
| `src/app/playbook/registry.test.ts` | 更新计数断言（当前 patterns 为 1 项） |

## 6. 禁区

1. 不把 `WorkflowCanvas` 改成读真实数据——那会造出第二个生产画布，问题反而变大。
2. 不动 `canvas-view.tsx` / `flow-elements.tsx` / `canvas-inspector.tsx`（生产画布归 ISSUE-008、ISSUE-012）。
3. 不动 `src/components/ui/node/**`（这些是已登记的 Canonical 组件，被生产画布使用）。
4. 删除前必须确认 `docs/designs/Design-system-inventory.md` 没有把它登记为必需组件族。
5. 修改 `routing.md` §11 收敛清单里的相关行时，遵循「先改真值文件再改代码」的顺序。

## 7. 验收标准

1. 本文件已记录选定方案与理由（含对 `Design-system-inventory.md` 的核实结论）。
2. `pnpm test` 全绿，特别是 `src/app/playbook/registry.test.ts`、
   `src/components/ui/canonical-components.test.ts`、`tests/cvc-ui-smoke.test.tsx`、
   `tests/app-route-contract.test.tsx`。
3. `pnpm typecheck` exit 0；`pnpm build` 成功；`pnpm verify:v3` 违规数不增加。
4. 全仓库 grep `PipelineNodeStatus`、`STAGE_B_WORKFLOW_NODES`：
   若选方案 A 则零命中；若选方案 B 则仅剩收敛后的单一定义。
5. `/playbook` 与 `/playbook/patterns` 真实 Chromium 截图，控制台无报错，
   页面不出现空分类占位或「将在 Stage B 接线」文案。
6. `docs/conventions/routing.md` §2.4 与 §11 中相关行已同步更新。
