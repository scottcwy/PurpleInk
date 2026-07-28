---
kind: design
name: AI 动作通过客户端 useRequireLogin() 弹窗门强制登录
source: session
category: adr
---

# AI 动作通过客户端 useRequireLogin() 弹窗门强制登录

_来源：f66d192 → be3df80 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
LaunchComposer（营销页 AI 演示）及 4 个客户端 api 模块（new-project/canvas-action/shot/export）在未登录时可调用后端接口，需在前端统一拦截并引导登录。

## 决策驱动
- 用户体验一致性
- 复用已有 ui/dialog + new-project-dialog 形状
- server/** 与 /api/engine/* 代理行为不动

## 备选方案
- **服务端直接 401 由前端各自处理** _（已否决）_ — 优点：最小改动；缺点：分散 alert/跳转逻辑，体验不一致
- **next-auth 统一鉴权** _（已否决）_ — 优点：生态成熟；缺点：PLAN-002 §10 硬边界明确不引入 next-auth，会话只走 cookie

## 决策
新增 'use client' 组件 login-required-dialog.tsx 与 useRequireLogin() hook，401 映射为统一可识别错误类型；LaunchComposer 调用 startRender() 前接 hook；回跳白名单沿用 safeNextPath()。

## 影响
客户端 401 归一化一处定义；server/** 与 /api/engine/* 代理行为一行不动；营销页 AI 演示与业务功能登录门行为一致。