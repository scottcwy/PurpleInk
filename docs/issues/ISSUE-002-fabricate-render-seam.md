# ISSUE-002 · FABRICATE→render 接缝断裂，`fabricateShot` 零调用方

- 优先级：**P0（阻断）**
- 状态：`open`
- 范围：`src/features/render` 与 `src/features/director` 的接缝。**不得触碰 `server/**`**
- 依赖：ISSUE-001（没有 pi 运行时，本 issue 无法端到端验证）
- 阻塞：ISSUE-005、ISSUE-014

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
