# ISSUE-011 · 设置页占位项与只读并发数

- 优先级：**P2**
- 状态：`open`
- 范围：`src/app/products/(app)/settings/**`
- 依赖：**ISSUE-004**（并发要先变成真实可配项，UI 才有东西可接）
- 性质：先决策「删掉还是接线」，再动手

## 1. 症状

`/products/settings` 上有两项不是真实功能：

| 项 | 位置 | 现状 |
| --- | --- | --- |
| 崩溃续渲 | `src/app/products/(app)/settings/settings-form.tsx:138-142` | 文案写死「尚未实现（Demo 占位）」 |
| 渲染并发数 | `settings-form.tsx:118` | 只读，标注「暂不可配置」，值来自 CPU 数 |

## 2. AGENTS.md 与 routing.md 的相关约束

AGENTS.md §6：

> 禁止固定假百分比、恒真成功 / QA、无 Artifact 的下载链接、**可点击但无行为的业务按钮**、永久 Skeleton。
> 未接线的页面必须显式显示未接线状态与未来数据来源。

routing.md §5 第 7 条：

> 禁止可点击但无行为的导航项。

当前这两项**已经做了显式标注**，严格说不算违规（比静默假开关好得多）。
所以这不是「必须马上修的 bug」，而是「要么删、要么接线」的收尾决策。

## 3. 逐项决策

### 3.1 渲染并发数 → 建议接线（依赖 ISSUE-004）

ISSUE-004 会把队列并发从单一数字改成按 kind 的配额通道：

```text
director-stage : 12
render-shot    : max(1, floor(cpus / 2))
```

接线后设置页应能配置这两个通道，而不是一个笼统的「渲染并发数」。

**要求**：
- 分开显示两个通道，各自说明影响什么（LLM 阶段 / 视频渲染），
  不要合并成一个数字——那会重现 ISSUE-004 的根本问题；
- 有范围校验（拒绝 0、负数、超过合理上限），校验失败返回 400 且不落写入
  （routing.md §4.1 约定 1）；
- 改动生效方式要明确：是热生效还是需重启队列？
  若需重启，UI 必须如实说明，**不得让用户以为已生效**；
- 这属于**账号级**设置还是**项目级**？routing.md §5 第 6 条要求
  `/products/settings` 必须分区并标注生效范围。并发是进程级资源，
  应归到账号级区块（不带 `projectId` 的那一半）。

**新增写操作需要先改 routing.md §4.1 登记表**（`/api/settings` 已存在，
若沿用它则需在表里补充其承载的字段范围）。

### 3.2 崩溃续渲 → 建议删除

理由：
- 「崩溃续渲」的真实语义需要 checkpoint 与断点续传能力。
  `task_attempts.checkpoint`（jsonb）虽然存在，但当前只存
  `{ schemaVersion, kind, payload }`（`in-process-queue.ts:54`），
  **没有任何中间进度**，所以续渲基础设施根本不存在。
- 渲染层已有更实用的等价能力：`src/features/render/cache.ts` 按 renderKey 命中缓存
  （`renderer.ts:66-73`），重跑时已渲好的镜头不会重复渲。
  这在效果上覆盖了大部分「崩溃后重来」的成本。
- 保留一个空开关会持续误导用户与后续开发者。

若决定保留，必须在本文件写明它依赖哪个 issue 才能实现，并给出 checkpoint 设计草案——
不接受继续留着「Demo 占位」文案。

## 4. 顺带核查

同一页面还有其他内容需确认是否真实（本 issue 一并核查，发现问题就地修或另开 issue）：

- 主题切换（`theme-control.tsx`，34 行）：面板描述已如实写明
  「界面主题仅保存到当前浏览器」（`settings-form.tsx:148`），**这是合规的**，
  只需确认 `next-themes` 的持久化行为与该文案一致，无需改动；
- 模型服务面板（`model-service-panels.tsx` 310 行、`model-service-settings.tsx` 172 行）：
  `POST /api/settings` 的 422 语义已实现（`route.ts:105-113`），本项只需回归确认；
- 项目级导出设置（带 `projectId` 时）与账号级凭据设置是否**分区清晰且各自标注生效范围**
  （routing.md §5 第 6 条）。

注意 `model-service-panels.tsx` 已 310 行，接近 350 硬上限，**不要在它上面加行**。

## 5. 修复范围

| 文件 | 动作 |
| --- | --- |
| `src/app/products/(app)/settings/settings-form.tsx` | 删除崩溃续渲；并发数改为两个通道的真实可配项 |
| `src/app/products/(app)/settings/model-service-contract.ts` | 并发字段的 schema 与校验 |
| `src/app/api/settings/route.ts` | 承载并发写入；校验失败 400 且不落写入 |
| `src/app/api/settings/route.test.ts` | 覆盖合法值、非法值（0/负数/超限）、不落写入 |
| `src/lib/queue/init.ts` | 从设置读取配额（与 ISSUE-004 的 env 覆盖路径统一，避免两个来源） |
| `docs/conventions/routing.md` §4.1 | 登记 `/api/settings` 新增承载的字段范围 |
| `tests/products-settings-layout.test.ts` | 同步布局断言 |

## 6. 禁区

1. 不保留任何「可点击但无行为」或「Demo 占位」的业务控件。
2. 不把并发合并成单一数字（那是 ISSUE-004 要消除的问题）。
3. 不让并发设置有**两个真值**（env 与 DB 各说一套）。必须定义清晰优先级，
   与 `features/ai/config.ts` 的既有口径保持一致：`DB > env > 代码默认值`。
4. 不在 `model-service-panels.tsx`（310 行）上加行，需要新面板就新建文件。
5. 不回显任何凭据明文或密文。
6. 不动 `server/**` 的并发或节流配置。

## 7. 验收标准

1. 本文件已记录两项的决策与理由。
2. 全仓库 grep `尚未实现`、`Demo 占位`、`暂不可配置` 在 `src/app/products/(app)/settings/**` 内零命中。
3. `pnpm test` 全绿，含新增的并发校验用例（合法 / 0 / 负数 / 超限，且非法时不落写入）。
4. `pnpm typecheck`、`pnpm build` 通过；`pnpm verify:v3` 违规数不增加。
5. **真实证据**：
   - 通过 UI 把 `director-stage` 配额从 12 改成 4，保存返回 200；
   - 起一个含 >= 6 个 unit 的项目，SQL 查询确认同时 `running` 的 director 节点数不超过 4；
   - 提交 `0` 与 `-1`，各返回 400 且**数据库中原值未变**；
   - 若并发改动需要重启才生效，UI 上有如实说明，且证据里记录该说明的截图。
   留档到 `docs/issues/evidence/issue-011/`。
6. `/products/settings`（带与不带 `projectId` 两种）真实 Chromium 截图，
   分区与生效范围标注清晰，控制台无报错。
