---
kind: external_dependency
name: Google Gemini AI 服务
slug: gemini
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
---

### Google Gemini AI 服务提供商
- 提供大语言模型能力，支持 gemini-3.6-flash 和 gemini-3.1-flash-lite 等模型
- 通过 GEMINI_API_KEY 环境变量配置，默认端点 https://generativelanguage.googleapis.com/v1beta/openai/
- 与 StepFun、MiMo 并列的三家内置托管服务之一
- Next 侧通过 CVC_MANAGED_GEMINI_API_KEY 使用托管模式
- worker 侧独立配置 GEMINI_* 相关环境变量
- 支持自定义 OpenAI-compatible 端点