# PurpleInk Script Video CLI：给 AI agent 的操作合同

这是一个只做“文稿 -> 代码镜头 -> 视频”的本地 CLI。它不使用项目计费、账号、远程项目、网站采集、数据库队列或平台 provider。AI agent 应把它当成本地构建工具：准备脚本文件，配置用户自己的 API，调用命令，读取 JSON 结果和 run 状态。

## 1. 输入文件

首选 JSON。UTF-8 编码，`schemaVersion` 必须为 `1`：

```json
{
  "schemaVersion": 1,
  "title": "要解释的主题",
  "language": "zh-CN",
  "durationSec": 42,
  "visualStyle": "technical editorial",
  "narration": "off",
  "units": [
    { "id": "U001", "text": "第一条可验证事实。", "visualIntent": "show" },
    { "id": "U002", "text": "第二条可验证事实。", "visualIntent": "compare" }
  ]
}
```

`durationSec` 为 5-600 秒；每个 `id` 必须是 `U###` 且唯一；文稿单元 1-128 个。也支持 Markdown：第一个一级标题是标题，二级标题下的段落成为文稿单元。

## 2. 用户自有 API

默认 provider 是通用 OpenAI-compatible Chat Completions，不要在脚本或仓库中写 key：

```powershell
$env:SCRIPT_VIDEO_AI_BASE_URL = "https://your-endpoint.example/v1"
$env:SCRIPT_VIDEO_AI_API_KEY = "由用户在本机注入的 key"
$env:SCRIPT_VIDEO_AI_MODEL = "your-text-model"
$env:SCRIPT_VIDEO_CONCURRENCY = "6"
```

CLI 会在 base URL 后追加 `/chat/completions`，请求只发送脱敏后的工作流输入，不把 credential、raw provider error、prompt 或隐藏推理写入结果。`doctor --json` 只报告 key 是否存在，不会回显 key。

## 3. 命令

在仓库根目录执行：

```powershell
pnpm cli doctor --json
pnpm cli plan examples/script-video/demo.json --json
pnpm cli run examples/script-video/demo.json --concurrency 6 --json
pnpm cli status --run .purpleink/runs/<run-id> --json
```

`run` 的顺序是：读取与 hash 输入、DIRECT 总纲、SHOT-SPEC 镜头合同、并发 FABRICATE HTML、静态 gate、Chromium seek gate、HyperFrames check/render、ffprobe 媒体 QA。输出中的 `videoPath`、`contentHash`、`sizeBytes` 和媒体元数据才是可交付证据。

`--no-browser-gate` 只适合本机没有 Chromium 时的诊断或快速开发；成功结果会标为 `degraded`，不能当作最终视觉验收。`--provider fixture` 只用于本地链路冒烟，不能作为真实 AI 结果。

## 4. 恢复与并发

每次 run 的状态在 `.purpleink/runs/<run-id>/state/`，镜头尝试和产物在同一 run 目录。某个阶段失败后，用同一个输入文件执行：

```powershell
pnpm cli run examples/script-video/demo.json --resume .purpleink/runs/<run-id> --json
```

CLI 会校验输入字节 SHA-256 和 workflow version；不一致时拒绝恢复。镜头代码生成可以并发，状态文件仍按镜头保存，不能并发覆盖同一个 attempt。

## 5. 数据库与边界

单机单进程默认不需要 PostgreSQL。文件状态足以支持恢复、审计和产物 hash；只有未来需要多个独立 worker 共享队列时，才新增 Postgres adapter。不要重新接回 billing、账户、远程项目、URL capture、音频来源/ASR 或 Web 工作台。

旁白是可选能力：`off` 不生成音频；`auto` 没有用户自有 TTS 时会明确降级；`required` 缺少 TTS 时必须失败，不能伪造音频或标记成功。
