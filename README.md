# PurpleInk Script Video CLI

PurpleInk 现在只负责一条本地链路：**UTF-8 文稿文件 → AI 导演与镜头合同 → 并发生成本地 HTML 镜头 → Chromium/HyperFrames 校验与渲染 → ffprobe 媒体验收**。

它不是 SaaS 工作台，不包含账号、计费、会员额度、远程项目、URL 采集、Web API、队列 Worker 或平台托管 provider。AI agent 的直接操作合同见 [docs/cli/AI-AGENT.md](docs/cli/AI-AGENT.md)。

## 快速开始

要求：Node.js 22.11+、pnpm 10.30.0、ffprobe，以及本机可用的 Playwright Chromium 和 HyperFrames。

```powershell
pnpm install
Copy-Item .env.example .env.local
# 在 .env.local 或当前 PowerShell 会话中填写用户自己的 API
pnpm cli doctor --json
pnpm cli run examples/script-video/demo.json --json
```

默认 provider 是通用 OpenAI-compatible Chat Completions：

```powershell
$env:SCRIPT_VIDEO_AI_BASE_URL = "https://your-endpoint.example/v1"
$env:SCRIPT_VIDEO_AI_API_KEY = "your-local-key"
$env:SCRIPT_VIDEO_AI_MODEL = "your-text-model"
```

CLI 只使用这些配置访问用户自己的 API；不会把 key 写入状态、产物、日志或错误输出。

## 命令

```powershell
pnpm cli doctor --json
pnpm cli plan <script.json|script.md> --json
pnpm cli run <script.json|script.md> --concurrency 6 --json
pnpm cli status --run .purpleink/runs/<run-id> --json
pnpm cli run <script.json|script.md> --resume .purpleink/runs/<run-id> --json
```

`--provider fixture` 只用于本地确定性冒烟，不代表真实模型调用。`--no-browser-gate` 只适合缺少 Chromium 的开发诊断；结果会明确标记为 `degraded`。

输入 JSON 示例见 [examples/script-video/demo.json](examples/script-video/demo.json)。支持 Markdown，但生产自动化建议使用 JSON，因为它能固定 schema、单元 ID 和视觉意图。

## 状态与产物

每次 run 默认写入 `.purpleink/runs/<run-id>/`：

- `input/`：输入文件副本；
- `state/run.json`、`state/stages/`、`state/events.jsonl`：可恢复状态与审计事件；
- `shots/`：每个镜头的 attempt HTML；
- `project/`：HyperFrames 项目、字幕、manifest 和 renders；
- `artifacts/video.json`：最终 MP4 的相对路径、字节大小和 SHA-256。

run 会校验输入源字节 SHA-256 与 workflow version。恢复不会复用不同输入的状态；已通过的镜头可以按指纹复用，未通过的镜头只会生成新的 attempt。

## 数据库决策

当前是单机单进程 CLI，不需要数据库。文件状态已经覆盖恢复、审计和产物登记，安装、备份和移动都更简单。只有未来需要多个独立 worker 共享抢占队列时，才增加同一 `StateStore` 接口的 PostgreSQL adapter；那时只保留 runs、shots、attempts、events、artifacts 五类表，不恢复旧 SaaS 的认证、计费或项目迁移。

## 验证

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm verify:v3
pnpm build
git diff --check
```

真实交付还应检查 CLI JSON 中的 `videoPath`、`contentHash`、`sizeBytes` 与 ffprobe 元数据，并抽帧确认画面不是空白或错误页。
