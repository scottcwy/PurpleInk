---
kind: design
name: 移除登录页体验账号弹窗提示但保留 seed 建号机制
source: session
category: adr
---

# 移除登录页体验账号弹窗提示但保留 seed 建号机制

_来源：f66d192 → be3df80 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
demo-account.ts + demo-account-dialog.tsx + login-form 集成由 CVC_DEMO_ACCOUNT_* 控制，用户要求删除前端提示链路但账号本身与 seed 机制不动。

## 决策驱动
- 用户明确要求删提示
- seed 默认无 env 即跳过无副作用
- 独立 commit 可 revert 恢复

## 备选方案
- **只靠 env 关闭弹窗不改代码** _（已否决）_ — 优点：改动最小；缺点：留死代码违反仓库纪律，用户明确要求删前端提示
- **连 seed 建号机制一起删** _（已否决）_ — 优点：彻底清理；缺点：用户明确「账号不要变」

## 决策
删除 login-form.tsx 中 demoAccount prop/state/fillDemoAccount()/按钮与 DemoAccountDialog 渲染、login/page.tsx 中 readDemoAccount() 调用、demo-account-dialog.tsx 与 demo-account.ts；docker-compose.prod.yml 删除 next 服务三行 CVC_DEMO_ACCOUNT_* 透传但保留 seed-demo-account 服务与其 env；.env.example 注释降级为仅供 seed-owner-account.ts --from-env 建号使用。

## 影响
登录页不再展示体验账号弹窗；seed 建号机制完整保留；独立 commit 支持 git revert 恢复。