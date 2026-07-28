---
kind: external_dependency
name: HyperFrames 管线工具
slug: hyperframes
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
source_files:
    - package.json
    - AGENTS.md
---

HyperFrames 是 PurpleInk 渲染 worker 的核心管线工具，通过 pnpm workspace 本地固定版本管理。用于处理视频渲染流水线，不允许运行时动态下载 CLI。