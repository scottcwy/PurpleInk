# ISSUE-012 修复前基线测量（Baseline）

- 测量日期：2026-07-25
- 测量人：ISSUE-012 执行会话
- 环境：本地 `pnpm dev`（Turbopack dev）+ Docker Postgres（127.0.0.1:54328）+ 无头 Chromium（browser-use）
- 目标项目：`6baf7165-6eab-45cc-abf7-ded8f67b71e1`（「ISSUE-012 基线测量 R2」，39 节点 = 4 全局 + 7 泳道 × 5）

## 方法

1. `getCanvasGraph()` 加临时插桩（追加行到 `.data/issue-012-graph-calls.log`：
   `epochMs \t projectId \t durationMs`）。插桩不提交，测量后移除。
2. 创建项目 → `POST /api/director/pipeline`（autopilot）→ INGEST、DIRECT 真实跑通并扇出
   7 条泳道；SHOT_SPEC 因上游缺陷全部失败（见"过程发现"§3）。
3. 用 `.data/issue-012-keeper.mjs` 每 3s 重入队 7 个 failed shot-script，持续 90s，
   制造稳定的 pending/running 活跃窗口。
4. 浏览器打开画布页（SSR 时存在活跃节点，1.5s 轮询 effect 激活），页内安装
   PerformanceObserver(longtask) 计数器。
5. 窗口结束后汇总插桩日志、节点 `updated_at` 与浏览器计数。

## 数据（修复前）

| 指标 | 实测值 |
| --- | --- |
| 观测窗口 | 121.1s（插桩日志首末行间隔） |
| `getCanvasGraph()` 调用次数 | **249 次** |
| 调用速率 | **2.06 次/秒**（≈124 次/分钟；高于 1.5s 名义周期，dev 下单次 refresh 触发多次渲染） |
| 单次耗时 | min 17ms / p50 23.1ms / p95 60.5ms / max 111.5ms |
| 每次调用 SQL 条数 | 41（1 节点查询 + 1 边查询 + 39 节点各一次 artifacts 查询，`queries.ts` N+2 模式） |
| 窗口内 SQL 总量 | ≈ **10,209 条**（249 × 41），仅为驱动一个只读画布页 |
| DB 状态变更 → 下一次画布查询延迟 | 7 个样本：992 / 1236 / 1252 / 1359 / 1407 / 1592 / 1949 ms（p50 **1359ms**，max **1949ms**） |
| 浏览器主线程 long task | 137.7s 内 22 次，累计 1200ms（无用户交互，纯轮询重渲染） |

结论：轮询驱动下「状态变更 → UI 可见」典型延迟 **1.2–2.0s，不满足 < 1s**；
且每 1.5s 支付一次全量图查询（41 SQL）+ dagre 重算 + RSC 序列化 + 客户端 reconcile。

### 结构性缺陷（测量中直接观察到）

页面加载时若**没有** pending/running 节点，`canvas-view.tsx:90-94` 的轮询 effect
永远不会启动——此后由 API/其它会话触发的节点活动在 UI 上**完全不可见**，必须手动
刷新整页。本次测量三次尝试均先踩中该缺口（重入队发生在页面加载之后），
这是推送方案（订阅项目而非订阅"当前是否有活跃节点"）要一并修复的真实缺陷。

## 决策

**选定方案 A（项目级 SSE 状态流）**：
- 方案 B（退避轮询 1.5→3→5s）最坏延迟 3–5s，连当前 1.5s 轮询的 1.9s 都不如，无法满足验收 <1s；
- 方案 C（不动）被上表数据否定：延迟不达标 + 每分钟 5,000+ 条 SQL 的纯浪费 + 上述结构性缺陷。

## 过程发现（不在 ISSUE-012 范围内，但为复现所必须）

1. **Turbopack 打包 pi-ai 导致 Director 全阶段不可用**：pi-ai dist 内的 provider
   懒加载动态 require 被 Turbopack 打包后抛
   `Cannot find module as expression is too dynamic`（MODULE_NOT_FOUND），
   `agent.state.errorMessage` 只剩 `An unknown error occurred`。
   修复：`next.config.ts` 的 `serverExternalPackages` 加入
   `@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`（随 Batch 0 一并提交，
   纯 Node 直连探针 `.data/issue-012-piai-probe*.mjs` 证实包本身工作正常）。
2. **`gemini-3.6-flash` 在 DIRECT 阶段稳定触发 finishReason→error**（pi-ai 将
   MALFORMED_FUNCTION_CALL 等一律映射为 error）；切到 `gemini-3.1-flash-lite`
   （`POST /api/settings` 写 DB，`primaryModel.source=settings`）后 DIRECT 成功。
   该 DB 设置**保留未回滚**，恢复 3.6-flash 需先解决其函数调用兼容性（ISSUE-013 邻域）。
3. **SHOT_SPEC 系统性失败**：全新会话下 7/7 节点报
   `Director Tool 输出缺失或无效：validate_shot_plan`，与模型无关（lite 同样失败），
   属 Director 工具输出提取/prompt 合同缺陷，阻塞全链路（含 render 泳道）证据，
   待上游修复后按计划补全链路对比数据。
4. 陈旧 `.next` 缓存曾导致旧 schema chunk 执行（INSERT 缺 position 列）；
   另注意 `.next` 的备份目录名必须仍被 .gitignore 覆盖，否则会被 Tailwind v4
   源扫描拾取产生损坏 CSS 类。

## 原始数据

- `baseline-graph-calls.log`：249 行插桩日志（epochMs/projectId/durationMs）
- `baseline-run.json`：首次全链路尝试（INGEST fetch failed，陈旧 chunk 环境）的时间线存档
- `baseline-window.json`：第二次窗口尝试（31s 即全部失败）的时间线存档
