# AGENTS.md — PurpleInk 本地文稿视频 CLI

本目录只提供 Windows 优先、Agent-first 的本地文稿视频工作流。保持 UTF-8，禁止 U+FFFD；不得恢复账号、计费、套餐、权限、工作区、云存储、SaaS 项目、Redis 或通用工作流编辑器。

## 操作合同

1. 先运行 `purpleink-video --help` 或仓库内 `pnpm cli --help` 获取实时命令合同。
2. 自动化一律优先 `--json`。除 `status --watch` 输出 NDJSON 外，结果形状为 `{ok, command, runId?, data?, error?}`。
3. 单个视频使用 `run`，不启动数据库。多个视频才使用 `daemon start` 和 `submit`。
4. WAV/MP3 可直接交给 `run`；需要先看转写时使用 `transcribe`。
5. `needs_attention` 不是成功。先 `inspect --run ... [--shot S001] --json`，再 `retry --failed` 或 `retry --shot S001`。
6. 用户要浏览器观察时运行 `serve --run ... --port 0`，返回仅绑定 `127.0.0.1` 的临时 URL。
7. 只有 `inspect` 返回最终 MP4 绝对路径，且媒体元数据、字节数、SHA-256 与三点抽帧都存在时，才能报告真实视频完成。

## 密钥

- 禁止 `--api-key <value>`；Agent 只使用 `--key-stdin`，人类可使用隐藏 TTY 输入。
- Key 只保存在 `%LOCALAPPDATA%\PurpleInk\secrets\` 的 CurrentUser DPAPI 密文中。
- 不把 Key、Authorization、请求头、Prompt、原始 provider 错误、Base64 音频或隐藏推理写入命令、日志、状态、HTML、截图或回复。
- 新配置必须先验证再覆盖；验证失败不得破坏旧配置。

## 状态与产物

- 文件状态是 run 的业务真值；PostgreSQL 只保存 pg-boss 队列表。
- 保留整个 run 目录。恢复依赖输入 SHA-256、workflow version 和阶段 fingerprint。
- `artifacts/index.json` 是 observer 唯一文件白名单。向用户返回其中的 `absolutePath`，不要自行猜路径。
- 一个镜头失败时，其他镜头继续；不要删除成功 attempt，也不要把缺少最终视频的 run 描述成成功。

## 开发边界

- TypeScript strict，禁止 `any`。保持单一职责和短文件。
- Prompt 只放在 `prompts/*.md`，其 SHA-256 必须参与阶段 fingerprint。
- 默认旁白必须真实存在；只有显式 `--narration off` 才允许无音频最终视频。
- 浏览器镜头必须本地、自包含、可 seek；禁止外部网络资源、任意文件读取和 credential-like 内容。
- 每完成一个可验证版块，只 stage 本版块文件并做本地 Conventional Commit；不 push、不创建 PR。

## 最终验收

集中在功能接齐后执行：配置连通性、TTS→ASR、真实文本模型镜头、至少 3×6 分镜并发、daemon 重启恢复、注入坏分镜后定向重试、observer Chromium 验收、ffprobe H.264/AAC 1920×1080 30fps、SHA-256、凭据扫描与 U+FFFD 扫描。fixture 只用于冒烟，不能替代真实交付。
