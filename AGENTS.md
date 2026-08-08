# AGENTS.md — PurpleInk Script Video CLI

本仓库只交付 Windows 优先、Agent-first 的本地文稿视频 CLI。所有文本保持 UTF-8，禁止 U+FFFD。详细机器操作合同见 `packages/script-video-cli/AGENTS.md`。

- 输入范围：Markdown、JSON、WAV、MP3。
- 单任务使用文件状态，不依赖数据库；批量 `submit/daemon` 只使用 pg-boss + Docker PostgreSQL 17。
- PostgreSQL 不保存用户、计费、项目、Artifact 业务表或凭据。
- 默认需要真实旁白；只有显式 `--narration off` 才允许无音频。
- 不引入账号、计费、套餐、权限、云存储、Redis、Next.js 工作台或通用工作流编辑器。
- Key 不得出现在参数、源码、测试、日志、状态、HTML、截图、commit 或回复中。
- 每完成一个可验证版块，只 stage 本版块文件并做本地 Conventional Commit；不 push、不创建 PR。

最终交付不能以 API 成功、queue succeeded 或 fixture 冒充。必须检查真实 MP4、ffprobe、SHA-256、三点截图、observer 和绝对路径。
