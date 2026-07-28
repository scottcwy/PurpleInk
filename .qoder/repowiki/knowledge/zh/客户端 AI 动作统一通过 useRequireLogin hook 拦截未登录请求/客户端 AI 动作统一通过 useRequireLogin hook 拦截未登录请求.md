---
kind: design
name: 客户端 AI 动作统一通过 useRequireLogin hook 拦截未登录请求
source: session
category: adr
---

# 客户端 AI 动作统一通过 useRequireLogin hook 拦截未登录请求

_来源：1ec15a3 → f66d192 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
LaunchComposer（营销页 AI 演示）等客户端功能在未登录状态下仍可发起渲染请求，缺乏统一的登录门和 401 错误归一化处理。

## 决策驱动
- 用户体验一致性
- 服务端守卫 + 客户端兜底双层防护
- 不改动 server/** 代理行为

## 备选方案
- **useRequireLogin hook + 401 映射统一错误类型 + LaunchComposer 前置拦截** — 优点：复用 UI 组件、一处定义错误处理、server 侧行为不变
- **各模块各自 alert/跳转处理 401** _（已否决）_ — 优点：简单直接；缺点：体验不一致、代码重复、易遗漏

## 决策
新增 `useRequireLogin()` hook 调用 `/api/auth/session` 校验，未登录弹出 `login-required-dialog` 并中止动作；4 个客户端 api 模块将 401 映射为统一错误类型；LaunchComposer 在调用 `startRender()` 前接同一 hook。

## 影响
营销页 AI 演示要求登录；回跳白名单沿用 `safeNextPath()`；server/** 与 `/api/engine/*` 代理行为一行不动。