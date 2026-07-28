---
kind: external_dependency
name: OpenAI 兼容模型服务
slug: openai
category: external_dependency
category_hints:
    - auth_protocol
    - sdk_real_api
scope:
    - '**'
source_files:
    - src/features/ai/openai-compatible-payloads.ts
    - docs/configuration/credentials.md
---

支持 OpenAI 兼容的文本/视觉模型，通过自定义 baseUrl + apiKey 配置。凭据加密存储于 provider_credentials 表，endpoint 和 model 存于 workspace_settings.ai.openai-compatible。校验时发起 /chat/completions 请求验证连通性。注意 schemaVersion: 2 的 profile-store 解析器与旧模块不兼容会导致 dev server 持有旧模块失败（模式 F）。