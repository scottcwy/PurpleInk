---
kind: external_dependency
name: 小米 MiMo 语音服务
slug: xiaomi-mimo
category: external_dependency
category_hints:
    - vendor_identity
    - auth_protocol
scope:
    - '**'
source_files:
    - docs/configuration/tts.md
---

MiMo 提供 TTS 和 ASR 能力，默认端点 https://api.xiaomimimo.com/v1。TTS 模型 mimo-v2.5-tts，ASR 模型 mimo-v2.5-asr，返回 WAV 格式。必须使用 sk- 开头的业务 Key，tp- Token Plan Key 面向编码工具不得保存。TTS 使用 Chat Completions 的 audio 字段，ASR 使用 input_audio data URL。非流式 ASR 没有逐词时间戳，字幕按实测音频时长生成整段时间边界。