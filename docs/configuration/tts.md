# TTS 与 ASR 配置

PurpleInk 的媒体能力与文本模型分别路由。旁白 TTS 和字幕 ASR 可选择小米 MiMo、
阶跃星辰，或各自独立的 OpenAI 兼容自定义端点；音频失败不会撤销已经提交的文本与
分镜合同。

本文件只覆盖 Next 应用内的媒体链路。`server/` 渲染 worker 有一条独立的 TTS 实现
（ListenHub，纯 env 配置），不读 `provider_credentials`，也不消费本页任何配置。

## 供应商

| 供应商 | provider id | TTS 默认模型 | ASR 默认模型 | 音频格式 |
| --- | --- | --- | --- | --- |
| 小米 MiMo | `mimo` | `mimo-v2.5-tts` | `mimo-v2.5-asr` | WAV |
| 阶跃星辰 | `stepfun` | `stepaudio-2.5-tts` | `stepaudio-2.5-asr` | MP3 |
| 自定义兼容 TTS | `openai-compatible-tts` | 用户填写 | — | 用户选择 MP3 或 WAV |
| 自定义兼容 ASR | `openai-compatible-asr` | — | 用户填写 | 沿用输入音频格式 |

MiMo 还允许显式选择 `mimo-v2.5-tts-voicedesign` 或
`mimo-v2.5-tts-voiceclone`。具体模型能否调用仍取决于产品 API 账户权限。

自定义端点没有默认模型：模型、音色与音频格式全部由用户在设置页填写，并在保存时
经真实调用校验。

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

## 自定义兼容音频端点

TTS 与 ASR 各是一个**独立**的接入点，与文本视觉端点（`openai-compatible`）互不共享
凭据、端点或模型。凭据分别加密存 `provider_credentials`，配置分别存
`workspace_settings` 的 `ai.openai-compatible.tts` 与 `ai.openai-compatible.asr`。

字段：

| 端点 | 字段 |
| --- | --- |
| TTS | `apiKey`、`baseUrl`、`model`、`voice`、`audioFormat`（`mp3` 或 `wav`） |
| ASR | `apiKey`、`baseUrl`、`model` |

`voice` 必填且不提供默认值：音色表由端点决定，无法推断。`audioFormat` 只开放
`mp3` / `wav`——旁白时长由 `measureAudio` 解码真实字节实测，而它只识别 MP3 帧头与
WAV fmt chunk，其他容器会让 FABRICATE 失去帧数依据。

协议：

- TTS 走 `POST {baseUrl}/audio/speech`，JSON body `{model, input, voice, response_format}`，
  响应是裸音频字节。该形状不返回时长与原生字幕，因此 `durationMs` 与
  `nativeCaptions` 由本地实测与后续 ASR 提供，不采信供应商自报值。
- ASR 走 `POST {baseUrl}/audio/transcriptions`，`multipart/form-data`。这是三家音频
  供应商中唯一的非 JSON 请求体。

### 时间戳能力在校验时协商一次

`response_format` 的支持度按模型不同：Whisper 系支持 `verbose_json`（配
`timestamp_granularities[]` 才返回分段时间戳），而部分较新的转写模型只支持
`json` / `text`。运行期逐镜探测会多打失败请求，还会让同一项目的字幕对齐方式漂移。

因此在「校验并保存」这一次真实调用里协商：先试 `verbose_json` + 分段粒度，被拒则退
`json`，把实际成功的那种持久化为 `timestampMode`：

| `timestampMode` | 含义 | `alignmentSource` |
| --- | --- | --- |
| `segment` | 端点返回分段时间戳 | `openai-compatible-asr-segment` |
| `none` | 端点不返回时间戳，字幕按实测音频总长整段对齐 | `openai-compatible-asr-whole` |

`verbose_json` 的 `segments[].start` / `.end` 是秒为单位的浮点，转 `Caption` 时按毫秒
取整。

### 设置页归属

供应商网格只有四张卡片，卡片是**家族**而不是 provider id。自定义兼容家族在 registry
里是三个 id（三份独立凭据必须有三个身份），但同属「自定义兼容模型」一个入口：选中该
卡片后，面板里按 文本与视觉 → TTS → ASR 顺序排三个接入点，各自有端点、模型 ID、
音色/格式、API Key 与独立的「校验并保存」。

卡片状态是三态：0 个已配置显示未连接，部分显示「N / 3 已配置」，全部显示已连接。
只用两态会在只配了一个端点时谎报整个家族可用。

### 校验判据与仅校验凭据

- TTS 校验发起一次极短真实合成，判据是返回非空音频字节。它同时验证了用户填写的
  `voice` 与 `audioFormat` 确实被该端点接受。TTS 不提供跳过。
- ASR 校验使用内存中生成的 1 秒 16 kHz 单声道 WAV 样本（不提交二进制 fixture，避免
  fixture 与代码期望脱节）。合成音无语义，转写结果可能为空字符串，因此判据是
  **HTTP 2xx 且响应体可被 schema 解析**，不是转写非空。设置页必须如实说明校验只确认
  端点、凭据与响应格式可用，不校验识别质量。
- 若端点对合成音直接返回 4xx，设置 API 回 422 且带 `reason: 'asr-transcription-rejected'`。
  设置页弹出说明后，用户可选择以 `credentialOnly: true` 重新提交。该路径**仍然先验证
  后保存**：需要 `GET {baseUrl}/models` 返回 2xx；此时 `timestampMode` 保守记为 `none`、
  `verification` 记为 `credential-only`，UI 必须显示「时间戳能力未验证」。

### 模型选择与媒体路由的同步

`media_routes.model` 是设置页「当前模型」与执行的共同真值，而自定义端点的模型来自
profile。保存 TTS/ASR profile 时必须同步 re-sync 所有指向该 provider 的
`media_routes.model`，否则 `narration.ts` 的 `assertEngine` 会以
「TTS 模型与配置不一致」失败，而设置页仍显示旧模型——一条谎报。

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
