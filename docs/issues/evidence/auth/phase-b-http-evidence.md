# PLAN-002 阶段 B 真实 HTTP 取证

取证时间：2026-07-28T06:48:37.311Z；目标 http://localhost:3000（真实 dev server + 真实 Postgres，无 mock）。
账号由 scripts/setup/seed-owner-account.ts 建立（各自独立 workspace），凭据不落本文件。

## 0. 账号准备

- 账号 A：e***@purpleink.local（独立 workspace）
- 账号 B：e***@purpleink.local（独立 workspace）

## 1. 未登录 POST /api/director/pipeline

- HTTP 401
- body: `{"ok":false,"error":"需要登录后才能访问"}`
- 断言：401 且不回显 projectId → 通过

## 2. 未登录 GET /api/projects

- HTTP 401（断言 401 → 通过）

## 3. 未登录 GET /products/dashboard

- HTTP 307，Location: `/login?next=%2Fproducts%2Fdashboard`
- 断言：30x 且回跳 /login?next= → 通过

## 4. 登录 A 后 POST /api/projects

- HTTP 201，projectId=02ab557c…
- 断言：201 → 通过

## 5. 账号 B 用 A 的 projectId PATCH /api/projects/[id]

- HTTP 404
- 断言：404（不区分不存在与无权限）→ 通过

- 追加：B 查 A 的导出状态 GET /api/render/export → HTTP 404（断言 404 → 通过）

## 6. 登录 A 后 SSE GET /api/director/stream/project/{projectId}

- HTTP 200，content-type: text/event-stream; charset=utf-8
- 收到 snapshot 帧：是；空闲期 keepalive：是（等待 15s）
- 断言：cookie 会话未破坏 EventSource → 通过

- 对照：未登录同 URL → HTTP 401（断言 401 → 通过）

## 7. 登录失败速率限制（同邮箱 10 / 15 分钟；同 IP 30 / 15 分钟）

- 本轮对新邮箱的第 5 次失败登录触发 HTTP 429，Retry-After: 719s。
- 如实说明：提前触发是因为同一取证机器前两轮脚本的失败登录已计入 **IP 维度**
  窗口（loginFailureByIp 30/15min 累计），属真实限流行为；Retry-After 的 719s
  与窗口已消耗约 3 分钟吻合。
- 断言：429 且带 Retry-After → 通过

---

全部序列为真实 HTTP 往返；验证码 / 口令 / 会话 cookie 值均不落本文件。
