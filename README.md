# PurpleInk Script Video CLI

> [!IMPORTANT]
> 这是独立维护的本地 CLI 产品分支，不是 PurpleInk 云端产品版本。禁止向 `main` 创建 Pull Request 或将本分支合并回 `main`；对外版本只使用 `local-cli/*` 标签和 GitHub Pre-release 分发。

本仓库只包含本地文稿视频工作流：Markdown/JSON/WAV/MP3 → DIRECT → 并发分镜 HTML、Chromium QA 与 MiMo 配音 → HyperFrames 渲染 → FFmpeg AAC 封装 → ffprobe/抽帧验收。

快速开始：

```powershell
pnpm install
pnpm cli --help
pnpm cli config show --json
pnpm cli run examples/script-video/demo.json --narration off --json
```

完整安装、配置、单任务、批量队列、声音克隆、observer 和故障处理见 [packages/script-video-cli/README.md](packages/script-video-cli/README.md)。Agent 操作合同见 [packages/script-video-cli/AGENTS.md](packages/script-video-cli/AGENTS.md)。离线功能介绍见 [packages/script-video-cli/introduce.html](packages/script-video-cli/introduce.html)。

它不是 SaaS 工作台，不包含账号、计费、会员、云项目、远程存储、Redis 或通用工作流编辑器。单任务不使用数据库；只有批量 daemon 使用 Docker PostgreSQL 17 保存 pg-boss 自有队列。
