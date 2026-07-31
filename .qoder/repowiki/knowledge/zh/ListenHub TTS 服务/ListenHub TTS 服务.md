---
kind: external_dependency
name: ListenHub TTS 服务
slug: listenhub
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
---

### ListenHub 语音合成服务
- 提供 TTS（文本转语音）能力，默认使用 listenhub-flowspeech 提供商
- 通过 LISTENHUB_API_KEY 环境变量配置，默认端点 https://api.marswave.ai/openapi
- 支持多种语音选择，如 nanzhongyin-4897116a
- 响应格式默认为 mp3
- 是项目中主要的 TTS 服务提供商