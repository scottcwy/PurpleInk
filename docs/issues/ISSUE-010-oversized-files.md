# ISSUE-010 · 2 个超硬上限文件使 `verify:v3` 恒红

- 优先级：**P2**
- 状态：`done`
- 范围：2 个文件及其拆出的兄弟文件
- 依赖：无。**可第一批并行**
- 性质：纯结构拆分，无行为变更

## 1. 症状

`pnpm verify:v3` 恒定 exit 1。这是当前**唯一**的门禁红项：

```json
{
  "ok": false,
  "violations": [
    {
      "ruleId": "OVERSIZED_NEW_FILE",
      "path": "src/app/products/(app)/export/[projectId]/export-workspace.tsx",
      "actualLines": 389,
      "hardLimit": 350
    },
    {
      "ruleId": "OVERSIZED_NEW_FILE",
      "path": "src/app/products/(app)/shots/[shotId]/shot-detail.tsx",
      "actualLines": 525,
      "hardLimit": 350
    }
  ]
}
```

门禁恒红的代价是**诊断信号失效**——任何真正的新违规都会被淹没在这两条里。
这个问题以前发生过一次（`docs/reviews/qoder-architecture-cleanup-2026-07-25.md` F-04）。

## 2. AGENTS.md 的相关约束

已知欠债一节明确写着：

> 已知欠债（`pnpm verify:v3` 当前为红，不是新引入的）：
> - `src/app/products/(app)/shots/[shotId]/shot-detail.tsx` 525 行；
> - `src/app/products/(app)/export/[projectId]/export-workspace.tsx` 389 行。
>
> 改动这两个文件所在的模块时必须顺带拆分；不得在它们上面继续加行。

以及规模门禁：

| 类型 | 目标 | 硬上限 |
| --- | --- | --- |
| `page.tsx` | 200 | 300 |
| 一般生产文件 | 250 | 350 |
| schema / repository（按聚合拆分） | — | 400 |
| 单函数 | 50 | — |

## 3. 关键要求：必须按真实职责拆，不许套壳

AGENTS.md 明令：

> 碰到硬上限或职责混杂，必须在**当前 Task** 内按 domain / application / infrastructure / UI
> 的真实职责拆分并复用公共代码。
> 禁止只套 re-export 壳、把大段代码搬到别处或制造循环依赖来规避门禁。

也就是说以下做法**全部不合格**：

- 新建 `shot-detail-part2.tsx` 把后 200 行搬过去；
- 新建 `index.ts` 做纯 re-export 让原文件变短；
- 把 JSX 拆成一堆只用一次、没有独立语义的匿名小组件；
- 把逻辑挪进 `utils.ts` 大杂烩。

## 4. 拆分方向

### 4.1 `shot-detail.tsx`（525 行）

同目录已有 `shot-panels.tsx`（222 行）、`shot-api.ts`（123 行）、`shot-server-data.ts`（62 行），
说明该目录已经有「面板 / API / 服务端数据」的分层习惯，沿用它。

建议先读文件确认实际内容后，按下列维度归类：

- **服务端数据装配** → 归入或新建兄弟文件（参考 `shot-server-data.ts` 的既有职责）；
- **客户端交互状态机**（重渲/QA/审批之类的本地状态与乐观更新）→ 独立 hook 文件；
- **纯展示面板** → 归入 `shot-panels.tsx` 或新建同级面板文件；
- **视图模型映射**（DB 行 → UI 字段）→ 独立 `*-view-model.ts`，
  参考 `export/[projectId]/export-view-model.ts` 的既有模式，且可单测。

### 4.2 `export-workspace.tsx`（389 行）

同目录已有 `export-api.ts`（93 行）、`export-view-model.ts`（29 行）。
只超 39 行，优先把**视图模型映射**与**轮询/状态逻辑**下沉到已有的
`export-view-model.ts` 与新的 hook 文件，通常一次即可达标。

注意 `export-view-model.test.ts` 目前只有 17 行，下沉逻辑后应同步补测试。

## 5. 修复范围

| 文件 | 动作 |
| --- | --- |
| `src/app/products/(app)/shots/[shotId]/shot-detail.tsx` | 拆到 <= 250 行（目标），必须 <= 350 |
| `src/app/products/(app)/shots/[shotId]/shot-panels.tsx` | 接收拆出的展示部分；注意它自己也有 350 上限 |
| `src/app/products/(app)/shots/[shotId]/*`（新增） | 视图模型 / hook |
| `src/app/products/(app)/export/[projectId]/export-workspace.tsx` | 拆到 <= 250 行 |
| `src/app/products/(app)/export/[projectId]/export-view-model.ts` | 接收映射逻辑 |
| `scripts/verify/v3-architecture-baseline.json` | 拆分完成后，从 `oversizedFiles` 中移除这两条 |

> **baseline 处理**：`writeV3ArchitectureBaseline` 在目标已存在时会抛错
> （`v3-architecture.ts:117-119`），所以不能直接用 `--report` 覆盖。
> 需要手动编辑 baseline 移除这两个键，或按脚本支持的流程重生成。
> **不得**通过「把行数写进 baseline」来让门禁变绿——那是掩盖而非修复。

## 6. 禁区

1. **零行为变更。** 本 issue 不修 bug、不改 UI、不改 API 调用。
   任何功能性改动都属于别的 issue。
2. 不制造循环依赖（`verify:v3` 与 `tsc` 不一定拦得住，需自查 import 图）。
3. 不把 client component 与 server component 的边界搞混——
   AGENTS.md 要求默认 Server Component，`'use client'` 下沉到确有交互的叶子。
   拆分是收紧这条边界的好机会，但不要顺手改变渲染语义而不验证。
4. 不动 `server/**`。
5. 不在这两个文件上再加任何行——包括为了拆分而临时加的注释。

## 7. 验收标准

1. `pnpm verify:v3` **exit 0**，`violations` 为空数组。这是本 issue 的核心指标。
2. `scripts/verify/v3-architecture-baseline.json` 的 `oversizedFiles` 里
   不再包含这两个路径，且**未新增**任何路径。
   `debtCaps.directOpenAiClientImports` 仍为 3。
3. 拆出的每个新文件都 <= 250 行，且能用一句话说明它唯一的变化原因。
4. `pnpm test`、`pnpm typecheck`、`pnpm build` 全绿。
5. **行为等价证据**：`/products/shots/[shotId]?projectId=` 与 `/products/export/[projectId]`
   两个页面在拆分前后各截一次真实 Chromium 截图，**视觉一致**，控制台无新增报错。
   证据留档到 `docs/issues/evidence/issue-010/`。
6. `AGENTS.md` 的「已知欠债」一节已更新（两条已还清则移除该节或改为空）。

## 8. 备注

这条门禁一旦转绿，后续所有 issue 就都能用「`verify:v3` 违规数不增加」作为客观判据。
因此**建议第一批就做掉**，它是其他 issue 验收标准的基础设施。

## 9. 完成证据（2026-07-25）

- `shot-detail.tsx`：525 → 144 行；
- `export-workspace.tsx`：389 → 107 行；
- 新增生产文件：73 / 188 / 109 / 52 / 234 行，均不超过 250；
- `pnpm verify:v3`：exit 0，`violations: []`；
- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`：exit 0；
- 全量测试：100 files / 434 tests passed；
- Chromium 1440×1000 前后截图逐文件 SHA-256 完全相同，console error 为 0；
- 详细证据：[`docs/issues/evidence/issue-010/baseline.md`](./evidence/issue-010/baseline.md)。
