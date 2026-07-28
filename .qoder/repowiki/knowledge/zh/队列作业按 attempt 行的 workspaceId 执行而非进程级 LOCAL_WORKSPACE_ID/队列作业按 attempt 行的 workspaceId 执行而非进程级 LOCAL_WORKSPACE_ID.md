---
kind: design
name: 队列作业按 attempt 行的 workspaceId 执行而非进程级 LOCAL_WORKSPACE_ID
source: session
category: adr
---

# 队列作业按 attempt 行的 workspaceId 执行而非进程级 LOCAL_WORKSPACE_ID

_来源：1ec15a3 → f66d192 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
阶段 A 已实现认证与 session，但队列系统仍硬编码使用 `LOCAL_WORKSPACE_ID`，导致所有用户的数据读写都指向同一个 workspace，新注册用户登录后看不到自己的数据。需要让每个作业在正确的用户上下文中执行。

## 决策驱动
- 多租户数据隔离
- 避免跨用户数据泄露
- 最小化改动范围

## 备选方案
- **从 attempt 行读取 workspaceId 并在 runInAuthContext 中恢复上下文** — 优点：利用现有 schema、无需迁移、天然支持并发多用户
- **给业务表加 userId 列并透传参数** _（已否决）_ — 优点：显式归属；缺点：PLAN-002 §5.2/§1.2 已否决（双真值/diff 淹没信号），且 ALS 基建已就绪

## 决策
在 `enqueue()` 中使用 `currentWorkspaceId()` 写入 attempt 的 workspaceId；`run()` 用 `runInAuthContext({ workspaceId: job.workspaceId, userId: SYSTEM_USER_ID })` 包裹 handler 执行；后续 UPDATE 改用 attempt 行的 workspaceId。

## 影响
队列 handler 内调用模块可安全使用 `currentWorkspaceId()`；需确保 B3 替换在 B1 之后进行，否则会出现「context not established」错误。