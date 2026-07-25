# ISSUE-006 取证：无 HTTP 请求时队列启动消费

- 取证日期：2026-07-25
- 验证对象：`src/instrumentation.ts` 在进程启动时调用 `initQueue()`，队列消费不依赖任何 HTTP 请求（ISSUE-006 验收标准 7）。

## 方法

主库上有 ISSUE-002 的 dev 进程（PID 63424，端口 3000）在同时消费，无法唯一归因。
因此在同一 Postgres 容器上新建独立取证库 `purpleink_issue006_evidence`：

1. `node .data/issue-006-evidence.mjs createdb` 建库；
2. `DATABASE_URL` 覆盖为取证库后执行 `pnpm db:migrate`（migration 全量应用成功）；
3. 种子一条 `task_attempts`：`task_id='legacy.noop'`（未登记 kind，走 fallback lane），`status='queued'`；
4. 启动服务进程（端口 3100，独立库），**全程不发送任何 HTTP 请求**；
5. 轮询该 attempt 状态。

一次性脚本 `.data/issue-006-evidence.mjs`（gitignore，不入库）；脚本只从 `.env.local`
读取连接串替换库名，不回显任何凭据值。

## dev 模式说明

Next 16 对同一项目目录加 dev 锁，第二个 `pnpm dev` 直接拒绝：

```text
⨯ Another next dev server is already running.
- Local: http://localhost:3000
- PID:   63424
```

ISSUE-002 的 dev 进程不可中断，故按计划预案改用生产模式取证
（`pnpm build` 产物 + `pnpm start --port 3100`）。生产模式下 instrumentation
是 Next 官方保证的触发路径；dev 模式另有 API 路由首请求兜底（`initQueue()` 幂等）。

## 结果

种子时刻（seed）：

```text
[evidence] seeded attempt=8d2ec4d6-3f47-49c3-8a4c-f2179f2f43bc status=queued at=2026-07-25T12:13:14.905Z
{"id":"8d2ec4d6-3f47-49c3-8a4c-f2179f2f43bc","task_id":"legacy.noop","status":"queued","failure":null,"started_at":null,"completed_at":null,"created_at":"2026-07-25T12:13:14.881Z"}
```

服务启动（`.data/issue-006-start.log`，全程零 HTTP 请求）：

```text
▲ Next.js 16.2.11
- Local:         http://localhost:3100
✓ Ready in 220ms
```

启动后查询（check）：

```text
[evidence] checked at=2026-07-25T12:15:40.553Z
{"id":"8d2ec4d6-3f47-49c3-8a4c-f2179f2f43bc","task_id":"legacy.noop","status":"failed","failure":{"message":"no handler for kind: noop","schemaVersion":1},"started_at":"2026-07-25T12:15:09.954Z","completed_at":"2026-07-25T12:15:09.967Z","created_at":"2026-07-25T12:13:14.881Z"}
```

## 结论

- attempt `8d2ec4d6-3f47-49c3-8a4c-f2179f2f43bc` 在零 HTTP 请求下被领取并完成
  （`queued` → `running` → `failed`，`started_at=12:15:09.954`，服务 Ready 后数秒内）；
- 失败原因 `no handler for kind: noop` 是 fallback lane 对未登记 kind 的如实拒绝，
  证明领取与执行循环真实运转，而非任何降级路径；
- 取证库无任何其他消费者，消费只能来自 instrumentation 启动的队列——归因唯一。
- 取证后：3100 服务进程已终止；主库与 ISSUE-002 的 dev 进程（3000/63424）全程未受影响。
