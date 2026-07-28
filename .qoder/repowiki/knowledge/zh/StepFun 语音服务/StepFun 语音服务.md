---
kind: external_dependency
name: StepFun 语音服务
slug: stepfun
category: external_dependency
category_hints:
    - vendor_identity
    - client_constraint
scope:
    - '**'
source_files:
    - docs/configuration/tts.md
    - docs/configuration/credentials.md
---

StepFun 提供 TTS 和 ASR 能力，默认端点 https://api.stepfun.com/v1，Step Plan 需使用 https://api.stepfun.com/step_plan/v1。TTS 模型 stepaudio-2.5-tts，ASR 模型 stepaudio-2.5-asr，返回 MP3 格式。账户欠费（HTTP 402）和限流（HTTP 429）是历史失败原因，路由已切走其他供应商。凭据通过 STEP_API_KEY 环境变量注入。