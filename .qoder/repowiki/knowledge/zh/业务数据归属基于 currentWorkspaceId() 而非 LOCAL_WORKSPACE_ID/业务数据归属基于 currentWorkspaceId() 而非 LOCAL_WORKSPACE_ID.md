---
kind: design
name: 业务数据归属基于 currentWorkspaceId() 而非 LOCAL_WORKSPACE_ID
source: session
category: adr
---

# 业务数据归属基于 currentWorkspaceId() 而非 LOCAL_WORKSPACE_ID

_来源：f66d192 → be3df80 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
阶段 A 已实现认证表与登录流程，但 13 条业务 API 未加守卫、/products 页面仅做 cookie 形状检查、约 50 个生产文件仍硬编码 LOCAL_WORKSPACE_ID，导致注册用户登录后看不到自己的数据、所有用户共享同一 workspace。

## 决策驱动
- 多租户数据隔离
- 避免双真值（userId 列 vs workspaceId）
- 复用现有 ALS 上下文基建

## 备选方案
- **给业务表加 userId 列显式透传** _（已否决）_ — 优点：查询直观；缺点：PLAN-002 §5.2 已论证产生双真值、diff 淹没信号，否决
- **每 workspace 并发配额** _（已否决）_ — 优点：按用户隔离资源；缺点：配额约束本机 CPU 与用户无关，进程级更简单且与 ISSUE-015 P-4 对齐
- **平台统一 AI key（系统凭据）** _（已否决）_ — 优点：集中管理；缺点：与 AAD 绑定 workspace 的加密设计冲突，需引入用量归属新概念；用户确认首版每用户自带 key

## 决策
全量替换 LOCAL_WORKSPACE_ID → currentWorkspaceId()：队列入队/消费在 request 或 runInAuthContext 上下文中取 workspaceId；API 入口统一包 withApiSession()；页面用 requireSession(currentPath) 查库校验会话；SSE pull 回调内闭包捕获 session.workspaceId。

## 影响
跨 workspace 隔离生效（A 拿 B 的 (projectId,artifactId) → 404）；队列 handler 必须在 B1 建立上下文后 B3 才替换；无 fallback 即显式失败便于契约测试拦截遗漏；迁移脚本 claim-local-workspace.ts 把既有 LOCAL workspace 归属到注册用户。