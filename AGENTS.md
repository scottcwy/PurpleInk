# AGENTS.md — PurpleInk

本文件是本仓库的代理执行入口。所有文本保持 UTF-8，禁止引入 U+FFFD replacement character 或破坏中文。
**除非用户明确要求，否则禁止切换分支，保持在yusheng/two-part-merge分支**

## 1. 执行前提

### 1.1 运行环境是 Windows

终端是 Windows PowerShell。写命令前先确认语法，实际踩过的坑：

- 命令分隔符是 `;`，不是 `&&`。
- 不支持 `cd`。要在子目录执行，用工具的 `cwd` 参数。
- `dir` / `ls` / `cat` / `grep` 都是 PowerShell 别名，不接受 cmd 或 GNU 风格参数。`dir /s /b`、`findstr /r`、`ls -la` 都会失败。
- 管道里的 `$_` 在跨 shell 传递时会被吞掉。需要 `Where-Object` / `ForEach-Object` 时，优先改用 `-Include` / `-Filter` / `Select-String`，或把脚本落到 `.ps1` 再执行。
- 路径带 `(` `)` `[` `]` 的（如 `src/app/products/(app)`）必须用 `-LiteralPath` 或单引号包裹。
- 读文件、搜索、编辑一律用专用工具，不要用 `Get-Content` / `Select-String` 代替。

### 1.2 长文件分批写入

一次性写入长文件会被截断，导致文件残缺。超过约 150 行或 6 KB 的内容：

1. 先写第一段；
2. 再逐段追加；
3. 写完核对字符数与章节数，确认没有截断。

### 1.3 每个版块单独 commit

仓库使用 Git。每完成一个可独立验证的版块，就为**本次改动的文件**做一次 Conventional Commit：

```powershell
git status --porcelain
git diff --cached --name-status
```

- 只 stage 当前职责的文件，不要 `git add .`。
- 提交信息用 `type(scope): 摘要`，正文说明改了什么、验证了什么。
- 未经用户明确授权，不得 push、创建 PR、force push 或改写远端。
- 禁止用 `git reset --hard`、`git checkout --` 或覆盖式命令清除用户改动。
- 禁止 `--amend` 已推送的提交；禁止 `--no-verify` 跳过 hook。
- 提交前检查是否夹带 `.env*`、构建物或凭据。

## 2. 产品边界

PurpleInk 是一套把产品事实与真实演示证据制作成发布视频的工作流。一个 Next.js 应用同时提供：

- `/`：营销页；
- `/products/*`：制作应用本体（工作台、项目、画布、镜头、导出、设置），接真实 Postgres、Artifact 与渲染队列；
- `/playbook/*`：组件登记与视觉验收；
- `/api/*`：Next 自有 API；
- `/api/engine/*`：反向代理到 `server/` 渲染 worker。

路由的唯一真值是 `docs/conventions/routing.md`。新增或删除任何可寻址表面（页面、API、元数据路由）必须先改那份文件，再改代码。

未接线的页面必须显式显示未接线状态与未来数据来源，不得接假数据库、假认证或假引擎。

## 3. 目录与公开边界

```text
src/
  app/                  页面、layout 与 API 薄入口
    (marketing)/        营销首页
    products/(app)/     制作应用（唯一应用壳挂载点）
    playbook/           组件登记
    api/                Next 自有 API
  components/
    marketing/          营销组件
    ui/                 共享 UI 原语（设计系统 SSOT）
  features/             canvas、artifacts、render、director、navigation、ai 等领域能力
  lib/                  数据库、存储、队列、配置与基础设施
server/                 渲染 worker
scripts/                数据库、验证与迁移脚本
tests/                  跨目录契约测试
docs/                   规范、设计与评审文档
```

- TypeScript `@/*` 只映射到 `./src/*`。
- 跨域复用现有公开导出（`src/features/*/index.ts`）；不要为同一职责增加平行 wrapper、第二套状态模型或纯 re-export 壳。
- `src/app` 只做参数解析、组合与响应映射，不放 SQL、渲染参数或复杂业务状态机。
- 应用壳只有一套：`src/features/navigation/app-shell.tsx`。禁止出现第二个 shell、第二个 sidebar 或第二套 pathname 到高亮的映射。
- 视觉只有一套：`docs/designs/canvas.pen` 是像素真值，`docs/designs/Design-system-inventory.md` 是文字索引，`/playbook` 是已登记组件的唯一清单。页面不得本地拼装平行的 Button / Card / Badge / Sidebar / Tabs。

## 4. 包管理与运行

唯一包管理器是 pnpm 10.30.0。根目录与 `server/` 由 `pnpm-workspace.yaml` 管理。

```powershell
pnpm install
pnpm dev                                      # Next，默认 http://localhost:3000
pnpm dev:worker                               # worker，默认 http://localhost:8787
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
```

- 不生成或提交 `package-lock.json`；不手改 `pnpm-lock.yaml`。依赖由 pnpm 命令产生并锁精确版本。
- `pnpm dev`、`pnpm dev:worker` 是长驻进程，必须放后台运行，不要在同步命令里执行。
- 本地 Postgres 由 `docker-compose.dev.yml` 提供；端口冲突时以 `.env.local` 实际值为准。
- HyperFrames 使用 workspace 本地固定版本，不允许运行时动态下载 CLI。

## 5. 文件与编码

规模门禁（由 `pnpm verify:v3` 真实执行，基线只允许持平或下降）：

| 类型 | 目标 | 硬上限 |
| --- | --- | --- |
| `page.tsx` | 200 | 300 |
| 一般生产文件 | 250 | 350 |
| schema / repository（按聚合拆分） | — | 400 |
| 单函数 | 50 | — |

- 一个文件只有一个主要变化原因。
- 碰到硬上限或职责混杂，必须在**当前 Task** 内按 domain / application / infrastructure / UI 的真实职责拆分并复用公共代码。禁止只套 re-export 壳、把大段代码搬到别处或制造循环依赖来规避门禁。

`pnpm verify:v3` 的 architecture violations 必须保持为空；不得把新超限文件写入
baseline 来掩盖门禁。

编码规则：

- TypeScript strict，禁止 `any`；用 `unknown` 加类型收窄。
- 默认 Server Component；`'use client'` 尽量下沉到确有交互需求的叶子组件。
- Next 16 用 `proxy.ts`，不用 `middleware.ts`。
- 异步入参 `params`、`searchParams`、`cookies`、`headers` 必须 `await`。
- 图标统一 Lucide，取自设计规范白名单，禁止 emoji。
- 不提交构建物、`.env*`、`.data/`、`.trigger/`、`out/`、`output/`、浏览器临时目录或凭据。

## 6. 数据与 UI 真值

- Postgres 是唯一结构化业务数据源；不得新增 SQLite 运行依赖或双写路径。
- approved / released Artifact 不可原地更新或删除；新版本使用新记录并保留 lineage。
- `content_hash` 必须来自实际字节的 SHA-256；文件大小、状态、版本与来源不能伪造。
- UI 可见字段必须可追溯到 API、数据库投影、Artifact，或明确标注的未接线占位。
- 禁止固定假百分比、恒真成功 / QA、无 Artifact 的下载链接、可点击但无行为的业务按钮、永久 Skeleton。
- 状态不能只靠颜色表达，必须同时有文本或图标语义。
- 不展示 raw assistant delta、tool 参数值、prompt、credential、provider 原始错误或隐藏推理。错误页只给类别文案与 `error.digest`。
- fixture、mock、真实 API / 模型调用必须分别标注；mock 渲染不得宣称为真实外部站点采集。

## 7. Key 与 secret

用户已授权代理读取 `.env` / `.env.local` 做本地验证，但：

- 只引用变量名，不回显值；
- 不写入源码、测试 fixture、截图、日志、commit 或对话；
- 禁止创建携带 secret 的 `NEXT_PUBLIC_*` 变量；
- 客户端不得解析 provider credential；
- 凭据只存加密内容，master key 只从 server-only 环境读取，不得明文 fallback；
- 设置类 API 必须先验证再保存；验证失败返回 422 且不覆盖已有 secret。

## 8. 验证

功能与修复遵循 RED → GREEN → 重构 → 验证。提交前至少运行：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm verify:v3
pnpm build
git diff --check
```

按变更范围补充：

- 涉及数据库：`pnpm test:pg`，并把 migration 连续执行两次；
- 涉及 API：`/api/*` 与 `/api/engine/*` 的真实 HTTP 证据；
- 涉及用户可见页面：真实 Chromium 截图与控制台检查；
- 涉及视频产物：`ffprobe`、实际文件哈希与可下载验证；
- 文本变更：对 `AGENTS.md README.md docs src server scripts` 做 U+FFFD 扫描。

无法运行某项验证时必须说明原因，不得声称已验证。

改动 Director / 渲染 / 音频 / 模型路由或任何阶段合同前，先读
`docs/conventions/workflow-failure-patterns.md`，并按其 §8 清单补做检查。
排查阶段失败时按其 §1 的顺序取服务端真值：UI 文案只是脱敏投影，原始报文在
`task_attempts.failure.message`。新发现的复发型失败追加为该文件的新模式，
不要另开文件。

## 9. 权威文档

| 文档 | 责任 |
| --- | --- |
| `docs/conventions/routing.md` | 全部路由、上下文参数、守卫与状态口径 |
| `docs/conventions/project-workflows.md` | 三来源项目的版本注册、创建/启动、计费、Artifact 与容灾边界 |
| `docs/conventions/workflow-failure-patterns.md` | Director / 渲染 / 音频 / 模型路由的复发失败模式、诊断顺序与已落地护栏 |
| `docs/conventions/design-quality-pitfalls.md` | UI 质感失败模式、廉价感根因与视觉交付前自查清单（改控件/页面视觉前必读） |
| `docs/designs/canvas.pen` | 视觉像素、token、reusable symbol 的 SSOT |
| `docs/designs/Design-system-inventory.md` | token、组件、页面与同步规则的文字索引 |
| `docs/designs/README.md` | `docs/designs` 内部权威关系 |
| `docs/configuration/tts.md` | TTS 配置 |

`docs/archive/**` 是历史迁移记录，只供追溯，不作为实现依据。
