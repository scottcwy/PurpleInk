# ISSUE-002 · FABRICATE→render 接缝断裂，`fabricateShot` 零调用方

- 优先级：**P0（阻断）**
- 状态：`done`（真实打通并取证，见 §9）
- 范围：`src/features/render` 与 `src/features/director` 的接缝。**不得触碰 `server/**`**
- 依赖：ISSUE-001（done，已提供 pi 运行时）
- 修复记录与证据：见 §9、[`evidence/issue-002/`](./evidence/issue-002/)
- 已解锁：ISSUE-005 剩余的运行时观测缺口（本次已补齐）、ISSUE-014 的「极小闭环」验证

## 1. 症状

`shot-codegen` 节点（承载 `FABRICATE` 阶段）永远无法产出 HTML，
一进入自动推进就失败，错误信息为：

```text
节点缺少 director-fabricate 产物：{nodeId}
```

这是**独立于 ISSUE-001 的第二个断点**。即使 pi 运行时完全修好，这一条不修，
链路仍然停在「有分镜合同、但没有可渲染的 HTML」，永远出不了 MP4。

## 2. 证据

### 2.1 `advancePipeline` 把 `shot-codegen` 分流到 render 队列，不进 director 队列

`src/features/director/advance.ts:99-111`

```ts
try {
  if (candidate.type === 'shot-codegen') {
    await resolved.enqueueRenderShot({ projectId, nodeId: candidate.id })
  } else {
    if (candidate.type === 'export') {
      await resolved.prepareFinalExport(projectId)
    }
    await resolved.enqueueDirectorStage({
      projectId, nodeId: candidate.id, stage: candidate.stage,
    })
  }
  result.enqueuedNodeIds.push(candidate.id)
}
```

### 2.2 render 队列从不生成 HTML，只消费 HTML

`src/features/render/queue-handler.ts:52-72`——handler 里没有任何 fabricate 步骤：

```ts
targetQueue.register('render-shot', async (job) => {
  const resolved = dependencies ?? createHandlerDependencies()
  const payload = renderJobPayloadSchema.parse(job.payload)
  await resolved.transitionNodeStatus(payload.nodeId, 'running')
  try {
    const context = await resolved.repository.loadRenderContext(   // <- 直接要 htmlKey
      payload.projectId, payload.nodeId
    )
    await resolved.renderer.render(context)
    ...
```

### 2.3 缺 HTML 产物就抛错

`src/features/render/render-shot-repository.ts:144-164`

```ts
      .where(and(
        eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
        eq(artifacts.projectId, projectId),
        eq(artifacts.aggregateType, 'node'),
        eq(artifacts.aggregateId, nodeId),
        eq(artifacts.kind, 'director-fabricate')
      ))
      .orderBy(desc(artifacts.version), desc(artifacts.createdAt))
      .limit(1)
    if (!artifact) {
      throw new Error(`节点缺少 director-fabricate 产物：${nodeId}`)
    }
    return artifact.storageKey
```

`buildRenderJob` 在 `render-shot-repository.ts:104` 无条件调用 `requireFabricateArtifact`。

### 2.4 失败发生在**入队时**，比 handler 更早

`enqueueRenderShot`（`queue-handler.ts:75-96`）先 `loadAdmissionContext`
（走同一个 `buildRenderJob`）再 `assertAdmission`，
所以 `advancePipeline` 一调用就抛，节点被 `compensateEnqueueFailure` 直接打成 `failed`。
用户在画布上看到的是「节点瞬间变红」，而不是「跑了一会儿失败」。

### 2.5 生成 HTML 的函数存在，但全仓库零调用方

`src/features/director/fabricate.ts:12-40`——注释已经把设计意图写清楚了：

```ts
/**
 * 为 shot-codegen 节点生成 HTML + renderSpec，但不改变节点状态。
 *
 * 渲染队列会在将节点置为 running 后调用本函数；保持 pending/running 状态不变，
 * 使后续渲染流程仍能使用自己的状态机（idle -> pending -> running -> success）。
 */
export async function fabricateShot(projectId: string, nodeId: string): Promise<void> {
```

全仓库 grep 结果：**只有定义处 1 个匹配，没有任何调用方。**

同一文件里三个依赖都刻意留成 no-op，进一步证明它就是为「被 render handler 调用」设计的：

```ts
transitionNodeStatus: async () => { /* 渲染队列自己管理 shot-codegen 节点状态 */ },
runStageEffect: async () => { /* FABRICATE 的真实副作用是 MP4 渲染，由 render queue handler 负责 */ },
advancePipeline: async () => { /* shot-codegen 只有 MP4 渲染成功后才能推进 */ },
```

### 2.6 状态机也已经为这个设计留了口子

`src/features/director/runtime-repository.ts:118`——`loadStageContext` 特别允许
`FABRICATE` 在节点已是 `running` 时加载上下文：

```ts
if (status !== 'pending' && !(status === 'running' && stage === 'FABRICATE')) {
  throw new Error(`Director 节点必须为 pending 或 FABRICATE 运行中，当前为：${status}`)
}
```

也就是说「render handler 先置 running，再调 fabricateShot」这条路径**已经被状态机显式支持**，
只差把调用接上。

## 3. 根因

`fabricateShot` 与 render handler 是同一次设计的两半，
但只落地了被调用方，调用点从未写入；同时 admission 校验把「HTML 必须已存在」
当成了入队前置条件，与「HTML 在 running 之后才生成」的设计相互矛盾。

这是**接线遗漏 + 一处前置条件放错位置**，不是架构分歧。

## 4. 修复方向

核心是把「HTML 是否存在」这个条件从**入队前置**降级为**渲染前置**：

```text
现状
  enqueueRenderShot  -> buildRenderJob(需要 htmlKey) -> 抛错
修复后
  enqueueRenderShot  -> 只校验 renderSpec 与节点可入队性（不要求 htmlKey）
  render-shot handler
    -> transitionNodeStatus(running)
    -> 若缺 director-fabricate 产物：await fabricateShot(projectId, nodeId)
    -> loadRenderContext（此时 htmlKey 必然存在）
    -> renderer.render(...)
    -> transitionNodeStatus(success) -> advancePipeline(...)
```

实现要点：

1. **幂等**：已有 `director-fabricate` 产物时**不重复生成**，直接进渲染。
   这条保证「渲染失败后重跑」不会浪费一次 LLM 调用，也让手动重试可预期。
2. **admission 拆分**：`loadRenderAdmissionContext` / `assertRenderAdmission`
   需要一个不含 `htmlKey` 的形态。避免的做法是把 `htmlKey` 改成可选而让下游到处判空；
   建议拆成「入队校验上下文」与「渲染执行上下文」两个类型，各自字段完整。
3. **失败归因要可区分**：fabricate 阶段失败与 render 阶段失败必须落成不同的错误来源，
   便于画布 Inspector 显示「HTML 生成失败」还是「渲染失败」。
   现有 `recordRenderError` 与 director 的 `recordStageError` 是两条路径，注意不要互相覆盖。
4. **依赖方向**：`render/queue-handler.ts:11` 已经 import `director/advance`，
   再加一条 `director/fabricate` 不新增循环，但会加深已登记的 features 间深导入债务
   （`docs/reviews/qoder-architecture-cleanup-2026-07-25.md` F-07，结论为 `不修`）。
   本 issue **允许**沿用现有形态，但不要为此新建第三个中间层。

## 5. 修复范围

| 文件 | 动作 |
| --- | --- |
| `src/features/render/queue-handler.ts` | handler 内在 `loadRenderContext` 前插入按需 fabricate；`enqueueRenderShot` 改用不含 `htmlKey` 的 admission 上下文 |
| `src/features/render/render-shot-repository.ts` | `buildRenderJob` 的 `htmlKey` 解析拆出；新增「入队用」上下文构造，不调用 `requireFabricateArtifact` |
| `src/features/render/admission.ts` | `assertRenderAdmission` 适配新的入队上下文类型 |
| `src/features/render/types.ts` | 新增入队上下文类型（不要把 `RenderJob.htmlKey` 改成可选） |
| `src/features/render/queue-handler.test.ts` | 补：缺 HTML 时调用 fabricate；已有 HTML 时不调用；fabricate 失败时节点转 failed 且不进渲染 |
| `src/features/render/admission.test.ts` | 更新为新上下文类型 |
| `src/features/render/repository.pg.test.ts`、`render.pg-fixture.ts` | fixture 需覆盖「无 `director-fabricate` 产物」这一新增合法状态 |

## 6. 禁区

1. 不改 `src/features/director/fabricate.ts` 的行为语义（它是正确的；只允许必要的签名微调）。
2. 不让 render handler 自己拼提示词或调模型——HTML 生成必须**只**经由 `fabricateShot`，
   否则会出现第二套 FABRICATE 实现。
3. 不放宽 `assertDeterministicSource`（`renderer.ts:65`）与 `check_determinism` 门禁。
   HTML 必须仍然满足确定性红线与 `window.__CVC_RENDER__@v1` 合同。
4. 不因为缺 HTML 就渲染占位画面、纯色帧或 fallback 模板。缺就失败。
5. 不改动 `shot-codegen` 的状态机语义（`idle → pending → running → success`）。
6. 不动 `server/**`。

## 7. 验收标准

1. `pnpm test` 全绿，且新增用例真实覆盖 §5 中列出的三个分支。
2. `pnpm typecheck` exit 0；`pnpm verify:v3` 违规数不增加。
3. `pnpm test:pg` 通过（本 issue 改了 pg fixture）。
4. **真实运行证据**（需 ISSUE-001 + ISSUE-003 先就绪）：
   对一个已完成 `SHOT_SPEC` 的项目，触发 `shot-codegen` 节点：
   - `artifacts` 表先出现 `kind='director-fabricate'`（`.html`），
     内容首字符 `<`、末字符 `>`，且包含 `window.__CVC_RENDER__`；
   - 随后出现渲染产物 MP4 artifact；
   - `ffprobe` 输出的时长、fps、分辨率与该节点 `data.payload.renderSpec` 完全一致；
   - 节点最终 `success`；
   - **再次**触发同一节点，确认 `director-fabricate` 产物**未新增版本**（幂等）。
   证据留档到 `docs/issues/evidence/issue-002/`。
5. 负向验证：手动删除 storage 里的 HTML 字节（保留 DB 记录）后重跑，
   必须如实失败并可从 Inspector 区分出失败来源，**不得静默重新生成或降级**。

## 8. 交付后应立即解锁

第一个真实单镜 MP4 → ISSUE-014 的「极小闭环」验证。

## 9. 修复记录（2026-07-25）

### 9.1 与原方案的偏差：先系统性分析，证伪了 issue 原文 §4 的前提

原文 §4「入队只校验 `renderSpec` 与节点可入队性」被证伪：ISSUE-005（`171f692`）落地后，
`shot-codegen` 首次由 `materializeShotLanes` 播种时的 payload 只有 `laneKey`/`laneRole`/
`sourceUnit`，**没有 `renderSpec`**——它只在 FABRICATE 成功提交后才写入。若入队仍解析
`renderSpec`，首次路径会在更早的 `parseRenderSpec` 处抛错，`fabricateShot` 永远不会被调用。

采用的实际方案：入队上下文（`RenderEnqueueContext`）**完全不解析 `renderSpec`**，只携带
`{projectId, nodeId, shotId}`；`frames`/`htmlKey` 的解析下沉到 `loadRenderContext`
（节点已处于 `running`、`fabricateShot` 已跑完之后）。

### 9.2 额外发现并修复的 P0 缺口（原 issue 未提及）

`enqueueRenderShot` 原实现里 `loadAdmissionContext` 的调用在 `try` 块之外，任何在此阶段
抛出的异常（包括首次路径必然出现的 `renderSpec` 缺失）都会绕过 render 自己的补偿链
（`compensateEnqueueFailure`：`idle→pending→running→failed` + `recordRenderError`），
直接冒泡给 `advance.ts` 的通用 `recordStageError`——那条路径**只写 `directorError`、
不转 `failed`**，导致节点永久停留在 `idle`，而 Inspector 的 `StreamingLogCard` 只在
`status === 'failed'` 时才展示错误，用户看到的是「什么都没发生」而不是「瞬间变红」（原文
§2.4 的描述）。已把 admission 加载纳入统一 try 块，按失败发生时点（`pendingSet` 是否已置）
选择正确的补偿转移序列。

### 9.3 UI 可见性缺口一并解决（原文 §4 第 3 条要求但未实现）

新增 `renderError`（对称于既有 `directorError`）：`CanvasGraphNode`/`queries.ts` 解析、
Inspector 的 `StreamingLogCard` 展示（标签「渲染失败」区别于「阶段失败」）。两个错误字段
互斥维护——`recordStageError` 写 `directorError` 时清掉残留 `renderError`，`recordRenderError`
反之，避免同一次失败展示两条互相独立又指向同一事件的噪音信号。

### 9.4 实际改动

| 文件 | 动作 |
| --- | --- |
| `src/features/render/types.ts` | 新增 `RenderEnqueueContext`（不含 `frames`）、`RenderAdmissionContext { enqueue, job }` |
| `src/features/render/render-shot-repository.ts` | `loadRenderAdmissionContext` 改为返回 `RenderAdmissionContext`；`job` 仅在 `director-fabricate` 产物已存在时非空；新增 `hasFabricateArtifact` |
| `src/features/render/queue-handler.ts` | handler 内按需调用 `fabricateShot`；`enqueueRenderShot` 把 admission 加载纳入统一补偿路径；新增 `failFabricate`（只转 failed，不写 `renderError`，避免与 `directorError` 重复） |
| `src/features/render/render.pg-fixture.ts` | `withFabricateArtifact:false` 时同步不再预置 `renderSpec`，还原真实首次入队状态 |
| `src/features/render/repository.pg.test.ts` | 新增「首次入队：无 renderSpec、无产物」与「重跑：产物已存在可预检」两个用例 |
| `src/features/render/queue-handler.test.ts` | 重写为三分支覆盖（缺 HTML 调 fabricate / 已有 HTML 不调 / fabricate 失败不进渲染）+ 补偿序列断言 |
| `src/features/render/persistence.ts` | 新增 `withoutPayloadKeys`，供两个 error 字段互斥清理 |
| `src/features/director/runtime-repository.ts` | `recordStageError` 写入时清掉残留 `renderError` |
| `src/features/canvas/queries.ts`、`index.ts` | 新增 `RenderNodeError` 类型与 `parseRenderError` |
| `src/app/products/(app)/canvas/[projectId]/streaming-log-card.tsx`、`canvas-inspector.tsx` | Inspector 展示 `renderError`，与 `directorError` 分标签 |

不改：`fabricate.ts` 行为语义、`advance.ts` 分流逻辑、`admission.ts` 签名、
确定性门禁、`shot-codegen` 状态机语义。

### 9.5 验证结果

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0（全仓库；唯一红是与本 issue 无关的既有文件 `live-status.test.ts`，见 Batch-002 交接） |
| `pnpm test` | 108 files / 498 passed |
| `pnpm test:pg src/features/render` | 3 files / 15 passed（含两个新首次入队用例） |
| `pnpm verify:v3` | `ok: true`，0 违规 |

### 9.6 真实运行证据（Gemini + StepFun 真实 API，非 mock 非 fixture）

对一个真实创建的项目（`purpleink-dev-postgres-1`）跑通 INGEST → DIRECT → SHOT_SPEC →
两条 `shot-codegen` 首次入队 → `fabricateShot` 生成 HTML → 真实渲染出 MP4：

| 泳道 | `renderSpec.durationInFrames` | `director-fabricate` | `render-mp4` | `ffprobe` 时长 |
| --- | --- | --- | --- | --- |
| S001 | 119（30fps） | version 1 | version 1 | 3.97s（≈119/30） |
| S002 | 227（30fps） | version 1 | version 1 | 7.57s（≈227/30） |

`ffprobe` 分辨率/fps（1080x1920 @30fps）与两个节点的 `renderSpec` 完全一致；两条泳道时长
不同且各自吻合，**同时补齐了 ISSUE-005 §9.4 遗留的运行时观测缺口**。

**幂等**：对已成功节点重跑，`director-fabricate`/`render-mp4` 均保持 `version=1`，
未触发二次 `fabricateShot`。

**负向验证**：手动删除 storage 里的 HTML 字节（保留 DB 记录）后重跑，入队 admission
阶段如实报 `渲染 source 读取失败`（HTTP 409），未静默重新生成；节点落 `renderError`
而非 `directorError`，验证后已恢复原字节。

**过程中处理的无关问题**（据实记录，未纳入本 issue 代码改动）：
- 本地开发 DB 的 `model_routes` 表存有早前设置页测试遗留的路由覆盖，把 `shot-spec`/
  `fabricate` 指向 `gemini-3.1-flash-lite`，该轻量模型对 `validate_shot_plan` 工具调用不稳定，
  已删除这两条覆盖记录使其回退到代码默认 `gemini-3.6-flash`（仅本地 DB 状态调整）；
- `gemini-3.6-flash` 在 DIRECT 阶段偶发把全部输出预算耗在隐藏 reasoning token 上返回空文本
  （`pi-ai` 的 `google-generative-ai.js` 把该情形归一为 `An unknown error occurred`），
  重试后即成功，与本 issue 改动无关；
- 两条泳道的 `shot-qa`（FINALIZE）下游节点失败，属 QA 阶段自身问题，不在本 issue 范围。

证据文件：`docs/issues/evidence/issue-002/first-run.json`。

## 10. 交付后已解锁

第一个真实单镜 MP4已产出（两条泳道）→ ISSUE-014 可以开始「极小闭环」验证。
