# ISSUE-012 修复后取证（After）

- 取证日期：2026-07-25
- 环境：本地 `pnpm dev`（Turbopack dev）+ Docker Postgres + 无头 Chromium（browser-use）+ Playwright 截图
- 修复实现：commits `a1cbe1d`（routing 登记）→ `6df8abf`（status-bus + 发布点）→ `a239b57`（SSE 端点）→ `f1a763e`（客户端集成）

## 验收对照（issue §8.5）

### 1. 状态变更 → UI 可见延迟 < 1s ✅

项目 `6baf7165`（39 节点），页面打开、SSE 健康，页内触发失败节点重入队，
每 150ms 采样泳道面板文本（`__issue012final.samples`）：

| UI 状态 | 距入队请求耗时 |
| --- | --- |
| 脚本 · 待执行 | **115ms** |
| 脚本 · 执行中 | 1220ms（含真实 pending→running 排队时间） |
| 脚本 · 失败 | 8222ms（真实模型调用耗时后） |

对比基线（DB 变更 → 下一次画布查询）p50 1359ms / max 1949ms：
状态可见延迟从「轮询周期决定」变为「事件到达即渲染」，**115ms ≪ 1s**。

### 2. getCanvasGraph 调用次数显著下降 ✅

项目 `1cbc0cf4`（R4），页面存活 353s（含一键启动 → INGEST → DIRECT → 扇出 →
7×SHOT_SPEC 全程活跃期），浏览器 Performance resource 计数：

| 指标 | 修复前（基线折算同时长） | 修复后实测 |
| --- | --- | --- |
| RSC refresh 次数 | ≈ 727 次（2.06/s × 353s） | **4 次**（集中在扇出与终态收敛时刻） |
| 对应 getCanvasGraph | ≈ 727 次 × 41 SQL | 4 次 × 43 SQL |

降幅 **99.4%**。SSE 长连接由服务端日志证实（单连接保持 52s / 83s / 9.6min / 10.4min）。

### 3. SSE 断开退回兜底并收敛 ✅

方法：给端点加临时 503（`TEMP-ISSUE-012-FALLBACK-TEST`，取证后已删除），
重入队节点后立即加载页面（props 含「执行中」）：

- 服务端日志：`GET /api/director/stream/project/1cbc0cf4... 503` × 3（EventSource 重试）；
  随后 `GET /products/canvas/1cbc0cf4...` 以 ~2s 节奏出现（1.5s 兜底轮询 + 渲染耗时）；
- 页面采样（`__issue012fb3.samples`）：`8ms 脚本·执行中` → `10093ms 脚本·已完成`，
  **UI 在 SSE 完全不可用时仍收敛到正确终态**；
- 撤掉 503 后端点恢复：首帧 `event: snapshot`（seq=7，含断连期间服务端累积的
  全部节点最新状态），重连即对齐，无需增量回放。

### 4. 扇出新增泳道正确显示 ✅

项目 R4 走真实用户路径：页面打开时 4 节点 / 0 泳道 → 页内点击「一键启动」→
画布**自动**变为 39 节点 / 7 泳道（`__issue012r4.samples`：`4n/0l` → `39n/7l`），
全程零手动刷新（topology 事件 + 防抖 refresh 生效）。
截图：`after-canvas-r4.png`（三条泳道「脚本 · 已完成」绿色语义标记 + 图标，
Pipeline 已提交 5/39 检查点，4 个节点失败如实显示）。

## 附注

- SHOT_SPEC 的 `validate_shot_plan` 工具输出提取缺陷实测为**间歇性**
  （同一节点重试即成功 2/7 → 后续又成功多个），仍属上游 Director 范围；
  本 issue 的推送链路对成功/失败两种终态均已验证。
- 兜底轮询继承了修复前的既有边界：页面加载时若无活跃节点且非 autopilot，
  轮询与 SSE 均不激活（修复前行为相同）；autopilot 开启时 SSE 常连，
  该缺口已比修复前显著收窄，彻底消除需后续把连接改为常驻（已超出本 issue 范围）。
- 全链路（含 render 泳道）对比数据仍受 ISSUE-002（open）与上述上游缺陷限制，
  已按计划以 INGEST→DIRECT→扇出→SHOT_SPEC 段留证。

## 原始数据

- `after-canvas-r4.png`：修复后画布真实截图
- 实时采样序列已内嵌本文件（115ms/1.2s/8.2s、4n/0l→39n/7l、执行中→已完成）
- SSE 长连接与 503/轮询兜底的服务端日志摘录见本文件 §3
