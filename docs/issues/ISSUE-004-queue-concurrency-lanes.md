# ISSUE-004 · 队列用单一并发数字混用 LLM 与渲染两类负载

- 优先级：**P1**
- 状态：`open`
- 范围：`src/lib/queue/**`。**不得触碰 `server/**`**（worker 有自己的串行 job runner 与节流器）
- 依赖：无。可与第一批其他 issue 完全并行
- 阻塞：ISSUE-011（设置页的「渲染并发数」要变成真实可配项）

## 1. 症状

「并发速率快」上不去，但**不是因为 provider 限流**。
实测 Gemini 16 路并发 16/16 成功、墙钟 1482ms、零限流（见 `README.md` §7）。
瓶颈在队列：两类负载完全不同的作业共用同一个并发上限。

| 作业 kind | 负载性质 | 合理并发 |
| --- | --- | --- |
| `director-stage` | 纯网络 I/O（LLM 请求，单次 2 秒级） | 高，>10 |
| `render-shot` | Chromium 实例 + 逐帧截图 + ffmpeg 编码，CPU 与内存密集 | 低，约 `cpus/2` |

现状把两者压在同一个数字上，导致：

- 想让 LLM 阶段快 → 调高并发 → 同时允许 N 个 Chromium 并行，内存与 CPU 打满，渲染反而更慢甚至 OOM；
- 想让渲染稳 → 调低并发 → LLM 阶段被无谓串行化，扇出后 N 个 `shot-script` 明明可以并行却排队。

## 2. 证据

`src/lib/queue/in-process-queue.ts:64-85`

```ts
start(concurrency = Math.max(1, os.cpus().length)): void {
  if (this.timer) return
  this.timer = setInterval(() => void this.tick(concurrency), 200)
}

private async tick(concurrency: number): Promise<void> {
  while (this.running < concurrency) {
    const job = await this.claim()
    if (!job) return
    this.running += 1
    void this.run(job).finally(() => { this.running -= 1 })
  }
}
```

`this.running` 是**单一全局计数器**，与 `job.kind` 无关。

`claim()`（`in-process-queue.ts:87-140`）也是 kind 无关的——
`FOR UPDATE SKIP LOCKED` 只按 `createdAt, id` 排序取最老的一条 `legacy.%` 作业：

```ts
.where(and(
  eq(taskAttempts.workspaceId, LOCAL_WORKSPACE_ID),
  eq(taskAttempts.status, 'queued'),
  like(taskAttempts.taskId, 'legacy.%')
))
.orderBy(asc(taskAttempts.createdAt), asc(taskAttempts.id))
.limit(1)
.for('update', { skipLocked: true })
```

注册的两个 kind（`src/lib/queue/init.ts:26-35`）：

```ts
directorMod.registerDirectorStageHandler(queue)   // kind: 'director-stage'
renderMod.registerRenderShotHandler(queue)        // kind: 'render-shot'
```

`queue.start()` 不带参数调用（`init.ts:36`），因此实际并发 = `os.cpus().length`。

### 2.1 附带发现：队头阻塞

因为 `claim()` 只取「最老的一条」，当队首是一个长时间的 `render-shot` 而并发已满时，
后面所有 `director-stage` 都拿不到槽位——即使 LLM 通道空闲。
这是单一队列 + 单一计数器的必然结果。

## 3. 修复方向

把并发从「一个数字」改成「按 kind 的配额通道」，改动**局限在 `src/lib/queue/` 内**。

```text
start(lanes?: Partial<Record<string, number>>)

默认配额
  director-stage : 12                        LLM I/O 密集，实测 16 路无限流，留 25% 余量
  render-shot    : max(1, floor(cpus / 2))   Chromium + ffmpeg，CPU/内存密集
  其他未登记 kind : 1                         保守兜底，避免新 kind 意外放飞

tick()
  对每个 lane 分别计算剩余配额
  claim(kind, remaining) 按 kind 过滤领取，避免队头阻塞
  running 改为 Map<kind, number>
```

### 3.1 实现要点

1. **`claim` 必须能按 kind 过滤。** 当前 `kind` 藏在 `taskAttempts.checkpoint.kind`（jsonb）里，
   而 `taskId` 是 `legacy.${kind}`（`in-process-queue.ts:48`）。
   因此可以直接用 `taskId = 'legacy.director-stage'` 精确过滤，**不需要改表结构、不需要迁移**。
   这是首选方案。
2. **保持 `FOR UPDATE SKIP LOCKED`**，不要退化成先查后锁。
3. **保持失败如实落库**：`completeAttempt` 写 `task_attempts.failure` 与
   `pipeline_runs.status` 的行为不变，不许吞错。
4. **保持幂等启动**：`init.ts` 的 `globalThis` 锚定防 split-brain 机制不要动。
5. **配额可配但要有安全边界**：并发数应能通过环境变量覆盖
   （便于 ISSUE-011 把它接到设置页），但要做范围校验，拒绝 0 与负数。
6. 未登记 kind 兜底为 1 而非 0，否则新增 kind 会静默永不执行。

### 3.2 明确不做

- **不引入外部队列**（BullMQ / Redis / Trigger.dev）。当前进程内 + Postgres 领取是有意选择，
  且 `src/features/pipeline/**` 的 Trigger 遗留层正在待清理（ISSUE-006），不要反向复活。
- **不改 `pipeline_runs` / `task_attempts` 表结构**。
- 不动 `server/**` 的 job runner 或 `step-client.ts` 的节流队列。

## 4. 修复范围

| 文件 | 动作 |
| --- | --- |
| `src/lib/queue/in-process-queue.ts` | `start` 签名改为按 kind 配额；`running` 改 `Map`；`claim` 增加 kind 过滤参数；`tick` 按通道分配 |
| `src/lib/queue/types.ts` | `QueueAdapter.start` 签名同步 |
| `src/lib/queue/init.ts` | 传入默认配额（可被 env 覆盖） |
| `src/lib/queue/in-process-queue.pg.test.ts` | 补：不同 kind 各自受独立配额约束；一个 kind 打满时另一个仍能领取（队头阻塞回归） |
| `src/lib/queue/init.test.ts` | 覆盖默认配额与 env 覆盖 |

## 5. 禁区

1. 不改 `QueueAdapter.enqueue` / `register` 的语义。
2. 不改 `queueFingerprint` 的计算方式（会影响去重与缓存判定）。
3. 不让并发上限变成「可点击但无效果」的 UI 项——若本轮不接 UI，就不要在设置页显示它（归 ISSUE-011）。
4. 不用假进度或固定百分比表达队列状态。
5. 不因为并发调高就移除 `assertRenderAdmission` 等前置校验。

## 6. 验收标准

1. `pnpm test` 与 `pnpm test:pg` 全绿，新增用例真实覆盖：
   - `director-stage` 与 `render-shot` 各自受独立配额约束；
   - `render-shot` 通道打满时，`director-stage` 仍能被领取（队头阻塞已消除）；
   - 未登记 kind 的并发为 1；
   - 非法配额（0、负数）被拒绝。
2. `pnpm typecheck` exit 0；`pnpm verify:v3` 违规数不增加。
3. **真实并发证据**（需 ISSUE-001 + ISSUE-002 + ISSUE-003 就绪）：
   建一个含 **>= 6 个 script unit** 的项目并「一键启动」，记录：
   - 扇出后同时处于 `running` 的 `director-stage` 节点数达到配额上限（截图或 SQL 查询留证）；
   - 同期 `render-shot` 的并行数不超过 `cpus/2`；
   - 全程无 OOM、无 Chromium 启动失败；
   - 与修复前的单一并发做一次墙钟对比。
   证据留档到 `docs/issues/evidence/issue-004/`。
4. 无法完成第 3 项时说明原因，不得声称已验证。

## 7. 备注

本 issue 独立于 P0 三条，**可以第一批并行开工**，
但第 3 项验收依赖 P0 全部落地，届时再补证据即可。
