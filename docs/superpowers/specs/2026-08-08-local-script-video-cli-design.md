# 本地文稿视频 CLI 设计

> 本设计把 PurpleInk 收敛为“文稿输入 → AI 生成镜头代码 → 本机校验与渲染”的本地工具。它不再承担 Web 产品、会员、计费或多来源项目平台职责。

## 目标

交付一个可被人或其他 AI 进程调用的本地 CLI。调用方只需提供一个文稿文件和本地 API 配置，CLI 就能生成可追溯的分镜、镜头 HTML/JS、旁白/字幕（可选）、HyperFrames 项目和最终 MP4。每个镜头可受控并发生成，失败可以从已完成镜头恢复，最终输出必须经过确定性检查、浏览器运行时检查、HyperFrames check/render 和媒体元数据校验。

“文稿视频”在本项目中固定解释为 script-first code video：文稿是事实来源，AI 负责把文稿拆成视觉职责和可执行镜头代码；不从 URL 采集网站，不接录音转写，不生成网站介绍视频。

## 非目标与删除边界

下列能力从运行时和公开 CLI 中删除，不以假实现或隐藏按钮保留：

- Next.js 营销页、产品工作台、Playbook、登录/注册、邮箱验证码和 workspace 成员。
- `audio` 来源项目、ASR 上传/转写和网站来源项目、浏览器采集、IMAP 自助注册。
- 会员、套餐、兑换码、额度、用量结算、费率、托管 provider funding 和 billing API。
- 远程对象存储、R2/S3 写穿、云部署反代和 Web→Worker 内部鉴权。
- 多来源 canvas 拓扑、数据库队列租约、SSE/HTTP Job API；CLI 自己的本地 run 状态取代它们。

保留的是文稿视频所需的纯能力：文稿解析、导演总纲、镜头合同、AI 镜头代码生成、HTML/JS 安全门禁、浏览器 seek smoke、HyperFrames 组合与渲染、字幕/媒体处理、QA、内容哈希和本地产物清单。

## 方案选择

### 方案 A：继续以 Next/Worker/Postgres 为核心

复用现有最多，但会把认证、计费、workspace 和跨进程队列的边界继续带入本地 CLI；调用方必须启动 Web、Worker 和数据库，无法形成单一可携带入口。否决。

### 方案 B：在现有 `server` 中增加一组 CLI 薄脚本

上线最快，但已有脚本面向 URL capture 和网站视频，且核心配置绑定 StepFun。继续堆脚本会形成第二套入口和隐式 provider 分支。只适合作为过渡，不作为最终边界。

### 方案 C：把 script-first 核心提炼为独立 CLI 包（采用）

以 workspace 包作为唯一公开入口，保留可复用的 HyperFrames/FFmpeg 适配器，重新建立不依赖 Next、`server-only`、Drizzle、认证和计费的纯 TypeScript 核心。CLI 默认文件状态，按镜头并发；需要共享队列时再通过同一 `StateStore` 接口增加 Postgres 实现，不改变上层工作流合同。

## 组件与职责

```text
packages/script-video-cli/
  src/cli.ts                 参数解析、退出码、机器可读输出
  src/contracts.ts           script-video.v1 / run / shot / artifact schema
  src/input.ts               Markdown/JSON 读取、规范化、SHA-256
  src/ai/openai-compatible.ts 通用 OpenAI-compatible 文本/JSON HTTP 客户端
  src/ai/concurrency.ts      有界并发、重试、退避、取消
  src/state/file-store.ts    原子 JSON、事件日志、恢复索引
  src/workflow/run.ts        阶段编排与幂等恢复
  src/workflow/plan.ts       INGEST/DIRECT/SHOT-SPEC
  src/workflow/codegen.ts    每镜 HTML/JS 生成与单镜验证
  src/workflow/assemble.ts   根 composition、旁白状态、字幕、产物清单
  src/render/hyperframes.ts  本地固定 CLI 的 check/render 包装
  src/qa/media.ts            ffprobe、hash、时长/帧率/分辨率门禁
```

每个文件只拥有一个主要变化原因。工作流层只依赖 `StateStore`、`AiClient` 和 `Renderer` 接口；默认实现是本地文件、OpenAI-compatible HTTP 和本机 HyperFrames/FFmpeg。没有任何层读取数据库表、会员状态或浏览器 session。

## 输入合同

Markdown 是人和 AI 最方便的入口；JSON 是机器编排的稳定入口。两者统一为 `script-video.v1`：

```json
{
  "schemaVersion": 1,
  "title": "示例视频",
  "language": "zh-CN",
  "durationSec": 30,
  "visualStyle": "editorial technical",
  "narration": "auto",
  "units": [
    { "id": "U001", "text": "真实产品事实。", "visualIntent": "show" },
    { "id": "U002", "text": "第二个事实。", "visualIntent": "compare" }
  ]
}
```

Markdown 标题 `#`/`##` 形成单元，正文是 `text`；文档头部可用 `title`、`durationSec`、`language`、`visualStyle` 和 `narration`。解析后拒绝空单元、重复 ID、未知 JSON 字段、越界时长和无法追溯的事实。输入原始字节哈希写入 run manifest，后续恢复不得静默使用另一份文稿。

## CLI 合同

```text
pnpm cli run <script.md|script.json> [--output <dir>] [--concurrency <n>]
  [--narration off|auto|required] [--provider <name>] [--resume <run-dir>]
  [--json]

pnpm cli plan <script.md|script.json> [--output <dir>] [--json]
pnpm cli status --run <run-dir> [--json]
pnpm cli doctor [--json]
```

`run` 是唯一产生视频的主命令；`plan` 只执行到 shot plan，便于 AI 先检查合同；`status` 只读本地事实；`doctor` 检查 Node、HyperFrames、Chromium、FFmpeg 和 provider 配置。默认输出到 `.purpleink/runs/<run-id>/`，也可用 `SCRIPT_VIDEO_STATE_DIR` 或 `--output` 覆盖，已有目录不覆盖。

机器输出只包含 `runId`、阶段、状态、计数、安全错误码、绝对产物路径、字节数、SHA-256、时长、帧率和配置摘要；不输出 API key、完整 prompt、raw provider response、隐藏推理或供应商原始错误。

## 工作流与并发

1. `INGEST`：读取并规范化文稿，建立 `scriptUnits` 和输入哈希。
2. `DIRECT`：一次 AI 调用生成 master plan/style bible，并由 schema 校验。
3. `SHOT_SPEC`：一次 AI 调用生成每镜 canonical shot plan；每镜绑定源 unit，不允许新增文稿事实。
4. `FABRICATE`：按 `--concurrency` 有界并发生成每镜 HTML/JS；每镜独立目录、独立 attempt 和独立错误状态。
5. `ASSEMBLE`：只接纳通过静态检查和 Chromium seek smoke 的镜头，生成根 composition；旁白/字幕是可选的同一 run 分支。
6. `FINALIZE`：HyperFrames check、render、ffprobe、时长/分辨率/帧率/编码与 SHA-256 门禁，最后写不可变 `manifest.json`。

并发只发生在无依赖的镜头 codegen 和镜头级验证。导演总纲、shot plan、合成和终稿保持顺序。每个外部请求使用有限重试与指数退避；取消时保留已完成镜头和失败事件，不把失败伪装成成功。`--resume` 只重跑缺失、失败或合同指纹变化的单元。

## AI 与凭据

CLI 使用自有配置，不存在托管 provider。v1 的真实 provider 配置是：

```text
SCRIPT_VIDEO_AI_BASE_URL=https://...
SCRIPT_VIDEO_AI_API_KEY=...
SCRIPT_VIDEO_AI_MODEL=...
SCRIPT_VIDEO_AI_VISION_MODEL=...
```

URL、模型和并发可由项目配置覆盖，但 credential 只能来自环境变量或被忽略的 `.env.local`，绝不写入 run、日志、HTML、测试 fixture 或产物。v1 不内置 TTS provider：`narration=off` 不生成音频，`auto` 在没有用户自有 TTS adapter 时明确标记 degraded，`required` 直接失败；未来接入 TTS 仍必须通过同一显式 adapter 合同。provider 只负责协议适配，工作流不感知具体厂商。

## 状态、恢复与数据库判断

默认 StateStore 使用受控 run 目录：

```text
run/
  input/source.*
  state/run.json
  state/events.jsonl
  state/units/U001.json
  state/shots/S001/attempt-001/{plan.json,source.html,result.json}
  composition/index.html
  renders/video.mp4
  artifacts/manifest.json
```

JSON 采用临时文件写入后 rename；事件日志只追加；每个状态文件带 `schemaVersion`、输入/合同指纹和更新时间。单机同一 run 的并发写入按独立路径隔离，主进程顺序汇总结果。这样无需数据库即可支持崩溃后查询、继续生成和精确产物哈希。

当前场景不需要 PostgreSQL：没有多租户、账号额度、远程 worker 或跨机器抢占，且 SQLite/文件状态更容易随项目移动和备份。若未来要求多个独立 worker 共享一个队列，增加 `PostgresStateStore`，只建 `runs`、`shots`、`attempts`、`events`、`artifacts` 五类表，使用事务和 `FOR UPDATE SKIP LOCKED` 抢占；不恢复现有 22 条 Web 迁移，也不把计费/认证表带回来。Docker Postgres 保留为可选 profile，不作为默认安装步骤。

## 验收

- 合同测试：Markdown/JSON 等价解析、未知字段拒绝、单位绑定、输入哈希和状态迁移。
- 并发测试：最大并发不超限、失败重试不重复成功写入、取消/恢复只重跑必要镜头。
- AI 测试：使用本地 fake OpenAI-compatible server；测试只验证请求形状、超时、429/5xx 退避和 JSON 校验，不记录 secret。
- 渲染测试：fixture HTML 通过静态/Chromium gate；真实 HyperFrames check/render 产出 MP4；`ffprobe` 核对容器、分辨率、帧率和时长；SHA-256 与 manifest 一致。
- 仓库门禁：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm verify:v3`、`pnpm build`、`git diff --check`，并对 `AGENTS.md README.md docs src server scripts packages` 扫描 U+FFFD。

## 迁移顺序

先建立独立 CLI 包和本地状态合同，再迁入文稿导演/镜头/渲染能力；CLI 真实 smoke 通过后，删除网站/音频来源、Web/认证/计费/远程存储及旧迁移入口；最后把根包脚本、README、Docker compose 和 CI 收口为 CLI 门禁。每一阶段都只提交本阶段文件，旧输出目录和用户的未跟踪数据不删除。

## 设计自检

- 目标覆盖：文稿文件输入、AI 自有 API、镜头并发、恢复、渲染、旁白/字幕、计费删除和数据库简化均有明确合同。
- 边界一致：CLI 默认没有 Postgres；Postgres 只作为未来共享队列的替换 StateStore，不影响工作流层。
- 可追溯性：所有阶段均有状态、事件、输入/合同指纹或最终产物哈希；失败不能生成成功投影。
- 安全性：凭据、prompt、供应商原始错误和隐藏推理不进入公开机器输出或产物。
