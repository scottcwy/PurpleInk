# PurpleInk 本地文稿视频 CLI

PurpleInk 把 Markdown、JSON、WAV 或 MP3 变成本地文稿视频。Markdown 先由语义 INGEST 逐句分析并形成“一单元一核心判断”的文稿单元；音频则在真实 FFmpeg 时间段上做相邻语义归组。随后 DIRECT 确定全片设计，分镜规划、HTML 生成、Chromium QA 和 MiMo 配音并发执行；全部镜头就绪后，HyperFrames 串行渲染视觉，FFmpeg 封装 AAC，最后用 ffprobe 与抽帧验收。

它面向 AI Agent，也允许人类直接敲命令。账号、计费、会员、工作区、云项目、云存储、Redis 和旧 SaaS 数据库都不在范围内。

## 安装

需要 Windows、Node.js 22.11+、pnpm 10.30.0、Docker Desktop、FFmpeg/ffprobe，以及 Playwright Chromium。

```powershell
pnpm install
pnpm build
pnpm cli --help
```

构建后可将 `purpleink-video` bin 链接到本机；仓库开发时直接使用 `pnpm cli` 即可。

## 配置

不要把 Key 放在命令参数中。Agent 通过 stdin 写入；人类省略 `--key-stdin` 时使用隐藏输入。

```powershell
$textKey | pnpm cli config set text `
  --url https://api2.agentsnav.com/ `
  --model gemini-3.6-flash-medium `
  --key-stdin --json

$speechKey | pnpm cli config set speech `
  --url https://api.xiaomimimo.com/v1 `
  --tts-model mimo-v2.5-tts `
  --asr-model mimo-v2.5-asr `
  --key-stdin --json

pnpm cli config show --json
pnpm cli config verify all --json
pnpm cli doctor --live --json
```

非敏感配置位于 `%LOCALAPPDATA%\PurpleInk\config.json`。Key 以 Windows CurrentUser DPAPI 密文单独保存在 `secrets` 目录。配置先验证后保存。

## 单任务

```powershell
pnpm cli plan .\script.md --json
pnpm cli run .\script.md --json
pnpm cli run .\script.json --concurrency 6 --json
pnpm cli run .\speech.mp3 --json
pnpm cli transcribe .\speech.wav --json
```

运行前可把用户确认的深浅色、平面/立体选择、指定风格及外部 Skill 中提炼出的视觉规则写入一个 UTF-8 文件。CLI 会把同一份约束注入 DIRECT、每个 SHOT-SPEC、每个 FABRICATE 和 HTML 修复，不影响语义拆稿、ASR 或 TTS：

```powershell
pnpm cli run .\script.md --global-prompt-file .\visual-constraints.md --json
pnpm cli plan .\script.md --global-prompt-file .\visual-constraints.md --json
```

Prompt 会复制为当前 run 的 `input/global-prompt.txt`，因此 daemon 重启和定向 retry 仍使用原约束。用户明确指定的全局风格应写成硬约束；允许 AI 按分镜决定的部分也应明确写出，不要把第三方 Skill 的命令、框架、测试或发布流程放入该文件。

默认必须生成真实旁白。只有明确不需要配音时才使用：

```powershell
pnpm cli run .\script.md --narration off --json
```

`--provider fixture` 和 `--no-browser-gate` 只用于开发冒烟；后者会令 run 成为 `degraded`。

### 语义拆稿

Markdown 不按标题数、字数、标点数或固定时长硬拆。INGEST 保留原文事实、限定语、疑问和顺序，平均每 1–2 句话形成一个 unit，但语义完整性优先；一个 unit 只承载一个核心判断并直接对应一个分镜。应用会校验所有 unit 连续、不重叠且完整覆盖原文，规范结果保存为 `input/semantic-script.json`。

JSON 输入视为调用方已经明确给出的 `U###` 单元合同，不再自动改写边界。WAV/MP3 只允许 AI 合并相邻 ASR 段，文本与首尾时间都继承真实分段，禁止猜测时间、跳段、重排或重复。

## 声音克隆

```powershell
pnpm cli voice import .\sample.wav --name my-voice --json
pnpm cli voice use my-voice --json
pnpm cli voice list --json
pnpm cli voice use mimo_default --json
```

样音只接受 WAV/MP3，Base64 后小于 10 MiB。文件复制到 `%LOCALAPPDATA%\PurpleInk\voices\`，索引只记录路径、格式、大小和 SHA-256。

## 批量队列

只有批量模式依赖 Docker PostgreSQL 17。`daemon start` 启动包内 Compose 和隐藏 worker；`daemon stop` 不删除数据库卷。

```powershell
pnpm cli daemon start --serve --json
pnpm cli submit .\a.md .\b.json .\c.mp3 --global-prompt-file .\visual-constraints.md --json
pnpm cli daemon status --json
pnpm cli status --run <run-id> --watch
pnpm cli daemon stop --json
```

PostgreSQL 仅含 pg-boss 自有表。job payload 只有 `runId/runDir`；Key、Prompt、Base64 音频和完整文稿永不入队。

## 查看、重试与取消

```powershell
pnpm cli status --run <run-id-or-path> --json
pnpm cli inspect --run <run-id-or-path> --json
pnpm cli inspect --run <run-id-or-path> --shot S001 --json
pnpm cli retry --run <run-id-or-path> --failed --json
pnpm cli retry --run <run-id-or-path> --shot S001 --json
pnpm cli cancel --run <run-id-or-path> --json
pnpm cli serve --run <run-id-or-path> --port 0 --json
```

`inspect` 返回阶段、镜头 HTML、三点 PNG、旁白、诊断、日志和最终视频的绝对路径。observer 只绑定 `127.0.0.1`，只允许读取 `artifacts/index.json` 已登记的文件；镜头 HTML 在禁止网络和本地路径访问的 sandbox iframe 中显示。

## 音频输入

FFmpeg 先转为 16 kHz 单声道 WAV，通过静音检测形成真实 `startMs/endMs`，最长分段约 45 秒。MiMo 只转写每段文字；文本模型按语义把相邻 ASR 段归为文稿单元，但不能改写段落文本或时间范围。程序按分组确定性拼接文字，并继承首段开始和末段结束时间。输出：

```text
input/normalized.wav
input/transcript.json
input/transcript.md
input/script.json
```

没有有效语音时返回 `ASR_NO_SPEECH`，不会伪造文稿。

## Run 目录

```text
runs/<run-id>/
  input/
    global-prompt.txt           # 可选；整部视频统一视觉约束
    semantic-script.json        # Markdown 语义拆稿结果
  state/run.json
  state/stages/
  state/events.jsonl
  state/metrics.json
  shots/S001/plan.json
  shots/S001/attempt-001/source.html
  shots/S001/attempt-001/screenshots/{000,050,100}.png
  shots/S001/attempt-001/diagnostics.json
  shots/S001/narration.wav
  project/
  final/video.mp4
  artifacts/index.json
  logs/
```

阶段 fingerprint 允许 daemon 崩溃或手动重试后跳过成功工作。`needs_attention` 表示仍有坏镜头，不会产生伪成功最终视频。

## 故障处理

- `CONFIG_VERIFICATION_FAILED`：检查 URL、Model ID、余额或网络；旧配置仍保留。
- `ASR_NO_SPEECH`：确认输入不是静音，并检查 FFmpeg 日志。
- `needs_attention`：先 inspect 分镜截图/HTML/诊断，再定向 retry。
- `QUEUE_DATABASE_UNAVAILABLE`：确认 Docker Desktop 正常，再执行 `daemon start`。
- `MEDIA_QA_FAILED`：查看 `logs/ffmpeg.log`、`logs/hyperframes.log` 与最终 ffprobe 元数据。

## Agent Skill

```powershell
pnpm skill:install
```

Skill 安装到 `%USERPROFILE%\.agents\skills\generating-purpleink-script-videos\`。Agent 应从 `purpleink-video --help` 获取命令，不复制本 README 的整份参数表。
