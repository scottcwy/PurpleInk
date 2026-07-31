---
kind: external_dependency
name: StepFun AI 服务
slug: stepfun
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
---

### StepFun AI 服务提供商
- 提供 TTS（语音合成）和 ASR（语音识别）能力
- 通过 STEP_API_KEY 环境变量配置，默认端点 https://api.stepfun.com/v1
- 支持 Step Plan 专用端点用于 TTS 和 ASR 功能
- 与 Gemini、MiMo 并列的三家内置托管服务之一
- Next 侧通过 CVC_MANAGED_STEPFUN_API_KEY 使用托管模式
- worker 侧独立配置 STEP_* 相关环境变量