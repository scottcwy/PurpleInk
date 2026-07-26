# TTS 与 ASR 配置

PurpleInk 的媒体能力与文本模型分别路由。旁白 TTS 和字幕 ASR 可选择
小米 MiMo 或阶跃星辰；音频失败不会撤销已经提交的文本与分镜合同。

## 供应商

| 供应商 | TTS 默认模型 | ASR 默认模型 | 音频格式 |
| --- | --- | --- | --- |
| 小米 MiMo | `mimo-v2.5-tts` | `mimo-v2.5-asr` | WAV |
| 阶跃星辰 | `stepaudio-2.5-tts` | `stepaudio-2.5-asr` | MP3 |

MiMo 还允许显式选择 `mimo-v2.5-tts-voicedesign` 或
`mimo-v2.5-tts-voiceclone`。具体模型能否调用仍取决于产品 API 账户权限。

## MiMo 凭据边界

业务后端必须使用 MiMo 产品 API 的 `sk-` Key，默认端点为
`https://api.xiaomimimo.com/v1`。`tp-` Token Plan Key 面向编码工具，
不得保存为 PurpleInk 的 MiMo 业务凭据；设置 API 会在验证前拒绝它。

本地非密钥覆盖项如下：

```dotenv
MIMO_BASE_URL=https://api.xiaomimimo.com/v1
MIMO_TEXT_MODEL=mimo-v2.5
MIMO_VISION_MODEL=mimo-v2.5
MIMO_TTS_MODEL=mimo-v2.5-tts
MIMO_ASR_MODEL=mimo-v2.5-asr
```

真实 Key 只通过设置页验证后加密保存，不写入仓库、浏览器状态、产物或日志。

## 异步媒体边界

INGEST 只提交可信 `scriptUnits` 并展开镜头；随后在同一持久队列中创建独立
`media-narration` 作业：

```text
INGEST 文本成功
  ├─ DIRECT -> SHOT_SPEC（立即继续）
  └─ media-narration -> 真实 TTS -> 实测音频时长
                     -> director-ingest-audio Artifact
                     -> 唤醒等待中的 FABRICATE
```

- 不写静音占位，不估算虚假时长。
- TTS/ASR 错误投影到入口节点的媒体状态，不把成功的 INGEST 改成失败。
- FABRICATE 必须读取真实 `audioAllocation`；媒体未就绪时保持 idle。
- 历史项目若旧 `director-ingest` 已包含有效音频合同，读取时仍兼容。
- 每段音频和组合时序都按不可变 Artifact 版本保存，保留 lineage。

## MiMo 协议

- TTS 使用 Chat Completions 的 `audio` 请求字段，从
  `message.audio.data` 读取 base64 音频。
- ASR 使用 `input_audio` data URL 与 `asr_options.language=auto`。
- 当前 MiMo 非流式 ASR 没有 StepFun 式逐词时间戳，因此字幕以实测音频时长
  生成整段时间边界，不伪造逐词对齐。
