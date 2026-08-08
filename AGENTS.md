# AGENTS.md — PurpleInk Script Video CLI

本仓库只交付本地“文稿视频” CLI：UTF-8 文稿输入、用户自有 AI API、并发镜头代码生成、本地 gate、HyperFrames 渲染和媒体 QA。禁止引入 U+FFFD replacement character 或破坏中文。

## 执行与 Git

- 环境是 Windows PowerShell；命令分隔符使用 `;`，路径含括号时使用 `-LiteralPath` 或引号。
- 唯一包管理器是 pnpm 10.30.0。不要生成 `package-lock.json`，不要手改 `pnpm-lock.yaml`。
- 除非用户明确要求，不切换分支、不 push、不创建 PR、不 force push，不使用 `git reset --hard` 或 `git checkout --`。
- 仓库任务每完成一个可验证版块，就只 stage 本版块文件并做 Conventional Commit；提交前检查 `git status --porcelain`、`git diff --cached --name-status`、`git diff --cached --check`，不得带入 `.env*`、构建物或凭据。
- 保留用户已有 dirty worktree、raw output 和个人数据；删除前必须确认它属于本次明确的 CLI 收敛范围。

## 产品边界

公开入口是 `packages/script-video-cli` 的 `purpleink-video`：

```text
script.json / script.md
  -> INGEST + SHA-256
  -> DIRECT
  -> SHOT-SPEC
  -> 并发 FABRICATE HTML
  -> 静态 gate + Chromium seek gate
  -> HyperFrames check/render
  -> ffprobe + 字节 hash QA
  -> 可恢复 run 与 artifact manifest
```

仓库不再承载 Next/Web 页面、API route、认证、workspace、项目平台、billing/会员/兑换码/额度、URL capture、录音转写、ASR、平台托管 provider、远程对象存储或后台 Worker。旁白是可选扩展：`off`、`auto`、`required` 三态必须如实投影，不能伪造音频。

## 数据与并发

- 单机单进程默认使用 `.purpleink/runs/<run-id>/` 文件状态，状态包含输入 hash、stage、attempt、事件和 artifact hash；不要新增 SQLite 运行依赖或恢复旧 SaaS PostgreSQL schema。
- 只有明确出现多个独立 worker 共享队列的需求时，才在同一 `StateStore` 合同下增加 PostgreSQL adapter；届时只保留 runs/shots/attempts/events/artifacts 五类表，Docker PostgreSQL 不是默认依赖。
- 生成镜头可以并发，但同一镜头 attempt 不得并发覆盖；resume 必须校验输入字节 SHA-256 与 workflow version。
- UI 不存在，因此 CLI 输出只给安全类别、状态、路径、大小、hash 和媒体元数据；禁止输出 credential、prompt、raw assistant delta、tool 参数、隐藏推理或 provider 原始错误。

## 编码与依赖

- TypeScript strict，禁止 `any`；用 `unknown` 加类型收窄。保持职责边界，复用公开导出，不制造平行状态模型或纯 re-export 壳。
- AI 只通过通用 OpenAI-compatible 接口配置 `SCRIPT_VIDEO_AI_BASE_URL`、`SCRIPT_VIDEO_AI_API_KEY`、`SCRIPT_VIDEO_AI_MODEL`；不得硬编码特定厂商名或 key。
- HTML 镜头必须是本地、自包含、可 seek、带 `data-pi-seed` 和 `window.__PURPLEINK_RENDER__`；不得使用外部 URL、data URL、远程字体或 credential-like 内容。
- 不提交 `dist/`、`.purpleink/`、媒体输出、`.env*` 或浏览器临时目录。

## 验证

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm verify:v3
pnpm build
git diff --check
```

涉及真实视频时，还要运行 `pnpm cli doctor --json`，用 fixture 和用户自有兼容 API 各做必要的 E2E，检查 `ffprobe`、实际文件 hash 和抽帧。无法运行的门禁必须说明原因，不能把 API/history 成功当作视频交付证明。
