---
kind: design
name: 业务查询全面改用 currentWorkspaceId() 替代 LOCAL_WORKSPACE_ID 常量
source: session
category: adr
---

# 业务查询全面改用 currentWorkspaceId() 替代 LOCAL_WORKSPACE_ID 常量

_来源：1ec15a3 → f66d192 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
注册用户在生产环境有独立 workspace，但约 40 个业务文件仍硬编码读写 `LOCAL_WORKSPACE_ID`，导致所有人共享同一 workspace 数据，新用户登录后看不到自己的数据。

## 决策驱动
- 数据隔离正确性
- 契约约束防止回潮
- 渐进式迁移

## 备选方案
- **全局替换为 currentWorkspaceId()，保留常量注释降级** — 优点：利用 ALS 基建、无函数签名变更、契约测试防回潮
- **给业务表加 userId 列或显式透传 workspaceId 参数** _（已否决）_ — 优点：显式归属；缺点：PLAN-002 §5.2/§1.2 已否决（双真值问题）

## 决策
全量替换 `LOCAL_WORKSPACE_ID` → `currentWorkspaceId()`（不改函数签名）；`createProject()` 删除 upsert workspace 逻辑（唯一创建点在注册事务）；新增契约测试断言 features 层不再 import `LOCAL_WORKSPACE_ID`。

## 影响
本地开发老数据「消失」属预期——通过 `claim-local-workspace.ts` 脚本把 LOCAL workspace 归属到注册用户；跨账户访问产物返回 404。