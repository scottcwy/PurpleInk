---
kind: design
name: 既有 API 统一接入 withApiSession 守卫，products 页面升级为查库会话校验
source: session
category: adr
---

# 既有 API 统一接入 withApiSession 守卫，products 页面升级为查库会话校验

_来源：1ec15a3 → f66d192 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
阶段 A 实现了 auth 基础设施，但 13 条业务 API 入口零调用 `withApiSession`/`requireSession`，未登录可直接调 AI 管线；`/api/director/pipeline` 未登录返回 409 且泄露内部 projectId。

## 决策驱动
- 安全边界收敛
- 统一错误码口径
- SSE 流上下文保持

## 备选方案
- **每条 API 包 withApiSession()，页面用 requireSession(currentPath) 查库校验** — 优点：最小侵入、复用已有守卫、明确区分公开/受保护路由
- **仅靠 proxy 的 cookie 形状检查** _（已否决）_ — 优点：改动最少；缺点：无真实会话校验，无法防伪造 cookie

## 决策
13 条既有 API 入口统一包 `withApiSession()`；`/api/ping` 保持公开；`/products/*` 页面入口接 `requireSession(currentPath)` 升级为查库校验；SSE 流必须在 handler 内闭包捕获 `session.workspaceId` 以维持上下文。

## 影响
未登录请求统一返回 401（替代旧 409）；归属不符一律 404；SSE pull 回调需依赖 handler 期捕获的 workspaceId。