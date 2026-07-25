# ISSUE-006 · `src/features/pipeline/**` 整层休眠，是第三套执行模型

- 优先级：**P2**
- 状态：`done`（2026-07-25，选定方案 A，见 §8 实施记录）
- 范围：`src/features/pipeline/**`、`vitest.config.ts`、`tsconfig.json`
- 依赖：ISSUE-001（共享 exclude 列表，见 `README.md` §6，001 先落地可省一次 rebase）
- 性质：**需要先决策，再动手。** 这不是纯 bug 修复

## 1. 症状

仓库里同时存在**三套执行模型**，其中一套完全无人调用：

| 执行模型 | 位置 | 状态 |
| --- | --- | --- |
| Director 阶段执行器 | `src/features/director/stage-runner.ts` | 生产路径（待 ISSUE-001 修复） |
| 渲染队列处理器 | `src/features/render/queue-handler.ts` | 生产路径 |
| **任务服务层** | `src/features/pipeline/**` | **零调用方，全部端口抛错** |

## 2. 证据

### 2.1 所有领域端口都抛「待绑定」

`src/features/pipeline/services/task-service.ts:28-37`

```ts
export function createPendingDomainPort(label: string): DomainTaskPort {
  return async () => {
    throw new TaskFailureError({
      schemaVersion: 1,
      code: "DOMAIN_ADAPTER_PENDING",
      userMessage: `${label} 领域适配器将在对应迁移阶段绑定`,
      retryable: false,
    })
  }
}
```

7 个 service 文件全部用它装配。例如 `services/shot-generate-service.ts:19-21`：

```ts
export const shotGenerateService = createShotGenerateService({
  shotGeneratePort: createPendingDomainPort("分镜生成"),
})
```

同构文件还有 `pipeline-run-service.ts`、`project-plan-service.ts`、`shot-media-service.ts`、
`shot-render-service.ts`、`shot-qa-service.ts`、`project-compose-service.ts`。

### 2.2 完整的一套平行契约

`src/features/pipeline/contracts/task-ids.ts:3-11`

```ts
export const CVC_TASK_IDS = [
  "cvc.pipeline.run",
  "cvc.project.plan",
  "cvc.shot.generate",
  "cvc.shot.media",
  "cvc.shot.render",
  "cvc.shot.qa",
  "cvc.project.compose",
] as const
```

`src/features/pipeline/execution-context.ts:12-25` 定义 `ExecutionContextV1`，
含 `triggerRunId`（Trigger.dev 遗留）、`fingerprint`、`workflowVersion`、`AbortSignal`、`ProgressSink`。
另有 `contracts/{failure,progress,status,tags,task-payload,task-result}.ts` 与 `progress/progress-sink.ts`。

合计 14 个文件、约 1400 行（含测试）。

### 2.3 零生产调用方

全仓库 grep `features/pipeline` 的结果，**只有测试与架构断言**：

```text
src/lib/architecture/v3-architecture.test.ts:132   '@/features/pipeline/trigger-adapter'    <- 断言"不应存在"
src/lib/architecture/v3-architecture.test.ts:166   '@/features/pipeline/project-plan-service'
src/features/pipeline/contracts/task-source-boundary.test.ts:24-58   （自身的边界测试）
```

`src/app/**`、`src/features/{director,render,canvas,audio}/**` 里**没有任何一处** import 它。

### 2.4 它的测试也被 exclude 掉了

`vitest.config.ts:14-15`

```ts
'src/features/pipeline/contracts/contracts.test.ts',           // 279 行
'src/features/pipeline/contracts/task-source-boundary.test.ts', // 303 行
```

`tsconfig.json:49` 额外把 `contracts.test.ts` 从 typecheck 排除。

所以这一层是「代码在、测试被关、无人调用」——纯死重量。

## 3. 需要先做的决策

> **已决策（2026-07-25）：选定方案 A（删除整层）。**
> 理由即下方方案 A 所列四条，全部成立且在实施前重新核实：删除前 grep 确认
> `src/app/**`、`src/features/{director,render,canvas,audio}/**`、`scripts/**`、
> `docs/`（非 archive）零生产引用，仅剩 fixture 断言与 pipeline 自身测试。
> 方案 B 在进程内单实例现状下收益为零；方案 C 只是把决策后推。实施见 §8。

有三条路，**必须先选一条并在本文件记录理由，再动手**：

### 方案 A：删除整层（推荐）

理由：
- 与 `stage-runner` / `queue-handler` 职责重叠，是同一件事的第三种表达；
- `triggerRunId` 是 Trigger.dev 遗留，而 `verify:v3` 已经把 trigger 相关 import 列为
  `src/features/canvas/**` 的禁区、并有 `TRIGGER_TASK_FORBIDDEN_IMPORT` 规则，
  方向是**清除**而非复活；
- AGENTS.md 明令「不要为同一职责增加平行 wrapper、第二套状态模型」；
- 留着它，任何新人都会先读到这层然后走错路。

成本：删 14 个文件 + 2 条 vitest exclude + 1 条 tsconfig exclude，
并确认 `v3-architecture.test.ts` 的相关断言仍成立。

### 方案 B：接线成真实执行层

即把 7 个端口真正绑定到 director / render 的实现，让它成为统一入口。
**只有在明确要引入外部队列或多进程编排时才值得。** 当前是进程内单实例，收益为零。
若选此路，必须同时说明它与 `stage-runner` 的关系（谁包谁），否则会变成四套。

### 方案 C：显式冻结

保留代码，但在 `src/features/pipeline/README.md` 写明「未接线、勿扩展、勿引用」，
并保留 exclude。**这是最差选择**——它把决策再往后推一轮，且死代码会继续腐化。

## 4. 若选方案 A 的修复范围

| 文件 | 动作 |
| --- | --- |
| `src/features/pipeline/**`（14 个文件） | 删除整个目录 |
| `vitest.config.ts` | 删除第 14、15 行（**只删这两条**，第 12、13 行归 ISSUE-001） |
| `tsconfig.json` | 删除第 49 行（第 47、48 行归 ISSUE-001） |
| `src/lib/architecture/v3-architecture.test.ts` | 第 132、166 行的断言按删除后的事实调整 |
| `vitest.config.ts:16` / `src/lib/db/runtime-boundary.test.ts` | 见 §5，单独处理 |

### 删除前必须确认

1. `src/features/render/**` 与 `src/features/director/**` 确实没有 import 它
   （已核实，但删除前再跑一次 grep）；
2. `docs/` 里没有把它当作实现依据的规范（`docs/archive/**` 不算）；
3. `scripts/**` 没有引用。

## 5. 附带项：`src/lib/db/runtime-boundary.test.ts`

`vitest.config.ts:16` 也 exclude 了它（241 行）。它引用 `@/instrumentation`
（`runtime-boundary.test.ts:45`），而**该文件在仓库中不存在**——
全仓库只有 `src/lib/queue/init.ts:5,15` 的注释提到 instrumentation。

需要判断：

- 若 Next 的 `instrumentation.ts` 应该存在（用于进程启动时 `initQueue()`），
  那么缺失它意味着队列**只能靠 API 路由首次请求兜底启动**（`init.ts:13-17` 的注释已承认这点）。
  这在生产里意味着「没人访问就不消费队列」。
- 若确定不要 instrumentation，则该测试的这条断言需要改写，并解除 exclude。

**本 issue 需要给出结论并落地其中一种**，不要继续 exclude 了事。

> **已结论（2026-07-25）：新增 `src/instrumentation.ts`。**
> `init.ts` 的 globalThis 防 split-brain 设计本就为 instrumentation 预留；缺失它意味着
> 生产环境「没人访问就不消费队列」。register() 内含 NEXT_RUNTIME/nodejs 与
> NEXT_PHASE/build 双守卫，模块顶层零副作用；同时修复了 `initQueue()` 失败缓存
> rejected promise 的毒化缺陷（失败重置 initializing 锚点，API 路由兜底可重试）。
> 本测试本身另有两处陈旧断言已一并修正：L248/L250 断言 better-sqlite3 以固定版本
> 存在于 devDependencies，而 package.json 已全面移除 SQLite——改为断言
> dependencies 与 devDependencies 均缺席（边界收紧）。exclude 已解除，5/5 通过。
> 「无 HTTP 请求时队列也能启动消费」的实测取证见 `evidence/issue-006/`。

## 6. 禁区

1. 不在删除的同时「顺手」把 `ProgressSink`、`TaskFailureError` 等挪到别处复用——
   那等于换个位置保留死代码。真需要时再从生产路径的需求出发重新设计。
2. 不复活 Trigger.dev 相关依赖或 import。
3. 不动 `server/**`。
4. 不为了让 exclude 变短而把测试文件删掉却保留生产代码（反向操作）。

## 7. 验收标准

1. 本文件已记录选定方案与理由。
2. 若选方案 A：`src/features/pipeline` 目录不存在；
   `vitest.config.ts` 与 `tsconfig.json` 中属于本 issue 的 3 条 exclude 已删除。
3. `pnpm test` 全绿，**文件数变化可解释**（删掉 2 个 exclude 文件 + 移除若干测试）。
4. `pnpm typecheck` exit 0；`pnpm build` 成功。
5. `pnpm verify:v3` 违规数不增加，`triggerTaskForbiddenImports` 仍为空。
6. `src/lib/db/runtime-boundary.test.ts` 的处置已落地（解除 exclude 并通过，或说明为何仍需 exclude）。
7. instrumentation 的结论已写入本文件；若决定新增 `src/instrumentation.ts`，
   需验证队列在无 HTTP 请求时也能启动消费。

## 8. 实施记录（2026-07-25）

与 ISSUE-002 在同一工作树并行实施，落点零重叠，全程未 stage 002 的未提交改动。

| Commit | 内容 |
| --- | --- |
| `1f545ed` | 删除 `src/features/pipeline` 整层（实数 **20** 文件，含 `services/service-contract.test.ts` 等，本文件 §2.2 记的 14 为低估，-1508 行）；回收 vitest 2 条 pipeline exclude + 失效的 Stage A 注释 + tsconfig 1 条；v3-architecture.test.ts 两处 fixture specifier 改为不含 pipeline 的等价样本 |
| `42568d2` | 新增 `src/instrumentation.ts`；修复 `initQueue()` 失败毒化（RED→GREEN，init.test.ts 新增失败重试用例） |
| `efc498f` | 修复 runtime-boundary 陈旧 SQLite 断言，解除最后一条历史 exclude |

验收对照：

- exclude 回收后 `vitest.config.ts` 仅剩 configDefaults + `**/*.pg.test.ts`（pg 分流，非门禁洞）；`tsconfig.json` 不再排除任何源文件。
- `pnpm test`：基线 108 文件/502 用例 → 删层后 107/492（-service-contract.test.ts 的 10 用例）→ 收口 108/498（+runtime-boundary 5 用例 +init 重试 1 用例）。
- `pnpm verify:v3`：ok:true 零违规，baseline 未动（fixture 断言不影响真实扫描计数）。
- `pnpm typecheck` exit 0；`pnpm build` exit 0 且不挂起（NEXT_PHASE 守卫生效）。
- 验收标准 7 取证：`evidence/issue-006/no-http-queue-consumption.md`（独立取证库，零 HTTP 请求下 attempt 从 queued 到被消费，归因唯一）。
