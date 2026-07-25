# PurpleInk + CodeVideoCanvas Stage A 迁移报告

> 执行分支：`feature/merge-cvc`
> 基线标签：`pre-merge-baseline`
> 目标仓库：`D:\projects\Dev-Tools\PurpleInk-dev`
> 只读来源：`D:\projects\Dev-Tools\CodeVideoCanvas`

## 执行原则

- 本报告只记录真实执行结果；失败项不会改写为成功。
- 未接线页面必须显式标注，不使用假数据、假进度或恒真状态。
- 敏感配置只记录变量名，不记录或提交其值。
- 来源仓库只读；最终同时记录 HEAD、迁移前状态和收口时状态。若执行期间出现外部工作区
  漂移，保持原样并单独标注，不能为了制造“状态一致”而改写来源仓库。

## M0 安全网与基线

执行时间：2026-07-25

### 仓库基线

| 项目 | 实际结果 |
| --- | --- |
| 初始 Git 状态 | 目标目录不是 Git 仓库 |
| 基线提交 | `1d41aa5 chore: baseline before cvc merge` |
| 基线标签 | `pre-merge-baseline` |
| 工作分支 | `feature/merge-cvc` |
| 来源仓库初始 HEAD | `0fd1800d4052ff824ca0a14402d3e6bd14116160` |
| 来源仓库初始状态 | 原有 1 个已修改文件和 4 组未跟踪路径；详见 M7 前后状态核对 |

### 工具版本

| 命令 | 退出码 | 实际结果 |
| --- | ---: | --- |
| `node --version` | 0 | `v24.15.0` |
| `npm --version` | 0 | `11.12.1` |
| `pnpm --version` | 0 | `10.30.0` |
| `docker version` | 0 | Client `29.4.3`；Docker Desktop `4.73.0`；Engine `29.4.3` |

### PurpleInk 基线门禁

| 工作目录 | 命令 | 退出码 | 结果 |
| --- | --- | ---: | --- |
| 根目录 | `npm run typecheck` | 1 | `KNOWN-BASELINE-FAIL`：依赖尚未安装，`tsc` 不可用 |
| 根目录 | `npm run build` | 1 | `KNOWN-BASELINE-FAIL`：依赖尚未安装，`next` 不可用 |
| 根目录 | `npm run lint` | 1 | `KNOWN-BASELINE-FAIL`：依赖尚未安装，`eslint` 不可用 |
| `server/` | `npm run typecheck` | 1 | `KNOWN-BASELINE-FAIL`：依赖尚未安装，`tsc` 不可用 |

这些失败由目标目录初始状态缺少 `node_modules` 导致。M0 按阶段边界不安装依赖、不修改源码，
因此将其作为已知基线失败继续；后续门禁必须在统一依赖安装后重新执行，不能把这里的失败
算作合并引入的回归。

## M1 目录形态改造

执行时间：2026-07-25

### 实际改造

- 使用 `git mv` 将根 `app/`、`components/`、`lib/` 移入 `src/`，根目录不再保留同名目录。
- 将 `motion.tsx` 改名为 `marketing-motion.tsx`，将 `config.ts` 改名为
  `site-config.ts`，并同步修正引用。
- 19 个营销组件全部移入 `src/components/marketing/`；引用修正未超过时间上限，无 waiver。
- `@/*` 唯一映射改为 `./src/*`；保留 `strict: true`，关闭计划指定的 6 个细分严格项。
- `.prettierignore` 已忽略计划指定的 CVC 导入目录；仓库没有把 `format:check` 接入现有门禁。
- 修正 `server/src/compose/run-pipeline.ts` 对共享 TTS 配置的相对路径，使其适配 `src/` 布局。

### 依赖引导记录

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| 根目录 `npm ci` | 1 | 现有 lock 与 manifest 不同步：lock 缺少 `zod@4.4.3` |
| 根目录 `npm install` | 1 | Windows 清理半成品依赖时出现 `ENOTEMPTY/EPERM` |
| 根目录 `pnpm install --lockfile=false` | 0 | 仅用于 M1 运行时验证，不生成 pnpm lock |
| `server/` 中 `pnpm install --lockfile=false` | 0 | 仅用于 M1 运行时验证，不生成 pnpm lock |

正式 workspace 与锁文件仍按 M2 的 `pnpm import`、`pnpm install` 流程生成。

### 退出门

| 命令或检查 | 退出码/结果 | 证据摘要 |
| --- | --- | --- |
| `pnpm run typecheck` | 0 | 根 TypeScript 检查通过 |
| `pnpm run build` | 0 | Next 16.1.1 构建成功，`/` 静态生成 |
| `pnpm exec next dev -p 3100` | 运行成功 | Next dev ready |
| `GET http://127.0.0.1:3100/` | 200 | HTML 包含首页标题 |
| Chromium 首页快照 | 通过 | 标题、营销区块、FAQ、页脚均渲染 |
| 主题切换 | 通过 | 根类从 `dark` 切换为 `light`，按钮标签同步变化 |
| smooth-scroll | 通过 | 根类包含 `lenis`；真实滚轮后 `scrollY` 从 0 到 900 |
| fluid-cursor | 通过 | 鼠标移动后流体 Canvas 保持活动尺寸 `1036x905` |

运行时控制台有 1 条 `favicon-16x16.png` 404；该文件在初始仓库即不存在，不影响 M1
规定的首页交互与构建门禁，留待 Stage B 静态资源整理。

## M2 包与工具链统一

执行时间：2026-07-25

### Workspace 与锁文件

- 新增 `pnpm-workspace.yaml`，成员为根包与 `server`。
- `pnpm import` 成功生成根 `pnpm-lock.yaml`；随后 `pnpm install` 在 58 秒内完成。
- 根与 `server/` 的 `package-lock.json` 已在同一阶段删除。
- 实际包管理器固定为 `pnpm@10.30.0`，未触发 `WS-PNPM-WAIVED`。

### 版本决策

| 包 | manifest 约束 | 实际安装版本 | 决策 |
| --- | --- | --- | --- |
| Next.js | `^16.2.0` | `16.2.11` | 按计划升级 |
| React / React DOM | `19.2.x` | `19.2.3` | 保持 19.2 系列 |
| lucide-react | `^1.26.0` | `1.26.0` | 升级；3 个已移除品牌图标换为通用 glyph |
| motion | `^12.42.2` | `12.42.2` | 按计划升级 |
| gsap | `^3.15.0` | `3.15.0` | 按计划升级 |
| zod | `^4.4.3` | `4.4.3` | 按计划统一 |
| playwright | `^1.61.1` | `1.62.0` | 根与 worker 统一范围 |
| hyperframes | `0.7.70` | `0.7.70` | 精确固定、本地执行 |
| postgres | `3.4.9` | `3.4.9` | 精确固定 |

其余计划依赖 `@xyflow/react`、`@dagrejs/dagre`、`clsx`、`tailwind-merge`、
`drizzle-orm`、`ffmpeg-static`、`jimp`、`openai`、`drizzle-kit`、`tsx`、`vitest`
均已写入根 manifest 和 lock。

### 被放弃的依赖

| 依赖族 | 状态 | 原因 |
| --- | --- | --- |
| Trigger.dev 相关包 | 未引入 | Master Goal 明确作废 |
| Pi Agent 相关包 | 未引入 | Master Goal 明确作废 |
| better-sqlite3 | 未引入 | 统一使用 Postgres |

`pnpm list/why better-sqlite3` 均为空；lock 中仅保留 `drizzle-orm` 自身声明的可选 peer 名称，
不对应已解析或已安装的包。

### HyperFrames 本地化

- `server/src/compose/render.ts` 的版本常量集中为 `HYPERFRAMES_VERSION = "0.7.70"`。
- `check` 与 `render` 均从 workspace 的 `node_modules/.bin/hyperframes` 调用，不再动态下载。
- 新增单元测试 `tests/hyperframes-local-command.test.ts`；先观察缺少本地解析函数的失败，
  再实现并验证通过。

### 退出门

| 命令或检查 | 退出码/结果 | 证据摘要 |
| --- | --- | --- |
| `pnpm import` | 0 | 成功导入 npm lock |
| `pnpm install` | 0 | 两个 workspace 包安装成功 |
| `pnpm typecheck` | 0 | lucide 兼容修正后通过 |
| `pnpm build` | 0 | Next 16.2.11 构建成功 |
| `pnpm exec next dev -p 3100` | 运行成功 | 首页返回 200 |
| `pnpm --filter purpleink-server dev` | 运行成功 | worker 监听 8787 |
| `GET http://127.0.0.1:8787/health` | 200 | `{"ok":true,"jobs":0}` |
| HyperFrames 本地命令测试 | 0 | 1/1 通过 |

## M3 CVC 视觉层与基础库

执行时间：2026-07-25

### 复制清单

所有目录均由 `robocopy /E` 从只读来源复制；退出码均为 1（成功复制新文件）。

| 目标目录/文件 | 文件数 | 行数 |
| --- | ---: | ---: |
| `src/components/ui` | 67 | 2073 |
| `src/components/icons` | 3 | 119 |
| `src/features/navigation` | 9 | 555 |
| `src/lib/motion` | 4 | 108 |
| `src/lib/gsap` | 2 | 28 |
| `src/lib/hooks` | 5 | 295 |
| `src/lib/layout` | 1 | 25 |
| `src/lib/determinism` | 4 | 99 |
| `src/lib/config` | 2 | 18 |
| `src/lib/storage` | 4 | 131 |
| `src/lib/stream` | 2 | 276 |
| `src/lib/queue` | 7 | 610 |
| `src/lib/workflow` | 3 | 100 |
| `src/lib/architecture` | 1 | 308 |
| `src/lib/utils.ts`（编译依赖） | 1 | 6 |
| `src/features/canvas/types.ts`（纯类型依赖） | 1 | 37 |

### 合并与适配

- 保留 PurpleInk 原有 `:root`、`.dark` 与 Tailwind 映射，追加 CVC 颜色、阶段、
  canvas、separator、圆角、阴影、时长和缓动 token。
- 根 layout 保留 Geist、Providers、SkipToContent、metadata、viewport；新增
  `theme-mode` 初始化脚本，并且只挂载一次 `AppMotionConfig`。
- `src/lib/utils.ts` 是复制 UI/导航组件的直接依赖，按原文件复制。
- node 类 UI 组件依赖 `canvas/types.ts`；该文件无运行时导入，因此提前复制纯类型契约，
  未提前复制 Canvas 业务实现。

### 临时依赖顺序豁免

M3 清单同时要求复制 `queue/architecture/workflow`，但这些目录的部分实现/测试依赖 M4
才允许复制的 DB、director、render 与 verify scripts。为避免 stub 和假返回值，M3 在
`tsconfig.json` 临时排除：

- `src/lib/queue/**`
- `src/lib/architecture/**/*.test.ts`
- `src/lib/workflow/**/*.test.ts`

M4 复制真实依赖后必须移除这三条排除并重新 typecheck。

### 退出门

| 命令或检查 | 退出码/结果 | 证据摘要 |
| --- | --- | --- |
| `pnpm typecheck` | 0 | 临时依赖边界生效，视觉层类型通过 |
| `pnpm build` | 0 | Next 16.2.11 构建成功 |
| CVC UI SSR 烟测 | 0 | Button、Card、StatusPill 同时真实渲染，1/1 通过 |
| `GET http://localhost:3100/` | 200 | 营销页返回正常 |
| Chromium 首页验收 | 通过 | 主要版式与 M1 一致，主题按钮完成 dark → light 切换 |
| 控制台 | 1 个已知 404 | 仍仅为初始仓缺少的 `favicon-16x16.png` |

## M4 CVC 数据层与业务后端

执行时间：2026-07-25

### 复制清单

| 目标目录/文件 | 文件数 | 行数 |
| --- | ---: | ---: |
| `src/lib/db` | 25 | 6439 |
| `src/features/canvas` | 12 | 1147 |
| `src/features/artifacts` | 3 | 295 |
| `src/features/pipeline` | 20 | 1349 |
| `src/features/render` | 38 | 4816 |
| `src/features/audio` | 16 | 1537 |
| `src/features/ai` | 13 | 1476 |
| `src/features/credentials` | 5 | 685 |
| `src/features/routing` | 5 | 458 |
| `src/features/director` | 50 | 5977 |
| `src/app/api` | 21 | 1275 |
| `scripts/setup` | 4 | 23 |
| `scripts/migration` | 5 | 503 |
| `scripts/verify` | 3 | 580 |
| `drizzle.config.ts` | 1 | 6 |
| `docker-compose.dev.yml` | 1 | 20 |

### 环境与 Postgres

- `.env.example` 已补齐数据库、测试数据库、凭据主密钥及 AI/媒体配置变量名。
- 被 Git 忽略的 `.env.local` 已配置 `DATABASE_URL`、`TEST_DATABASE_URL`，并使用
  `RandomNumberGenerator.Create().GetBytes()` 生成 32 字节 `CVC_CREDENTIAL_MASTER_KEY`。
- 初次 Docker 启动失败：`127.0.0.1:54327` 已被
  `codevideocanvas-postgres-1` 占用。为避免写入来源项目数据库，记录
  `PG-PORT-WAIVER`，目标仓隔离容器改用 54328。
- 目标容器 `purpleink-dev-postgres-1` 健康检查为 `healthy`。
- `drizzle.config.ts` 的 schema/out 分别指向
  `./src/lib/db/schema/index.ts` 与 `./src/lib/db/migrations/pg`。

### Stage A 屏蔽点与测试范围

| 位置 | 处理 | 原因 |
| --- | --- | --- |
| `src/features/director/pi-session.ts` | `NOT_AVAILABLE_STAGE_A` 显式错误 | Pi runtime 已作废且未引入 |
| `src/features/director/session-store.ts` | `NOT_AVAILABLE_STAGE_A` 显式错误 | Pi JSONL 会话属于 Stage B |
| `scripts/migration/**` | 从 typecheck 排除 | 本 Goal 明确不迁移 CVC 历史 SQLite 数据 |
| `src/features/director/pi-session.test.ts` | 从 typecheck 排除 | 测试绑定已作废 Pi SDK |
| `src/features/director/session-store.test.ts` | 从 typecheck 排除 | 测试绑定已作废 Pi JSONL 实现 |
| `src/features/pipeline/contracts/contracts.test.ts` | 从 typecheck 排除 | 测试绑定已作废 Trigger 队列 |

`pi-output` 仅依赖消息结构，已改为本地结构类型；其 9 项解析测试继续通过。新增
`stage-a-unavailable` 测试，确认 Director 会抛稳定错误而不是返回假结果。

### 数据库门禁

| 命令或检查 | 退出码/结果 | 证据摘要 |
| --- | --- | --- |
| 第一次 `pnpm db:migrate` | 1 | 脚本未加载 `.env.local` |
| 修正后第一次 `pnpm db:migrate` | 0 | 从零应用 Postgres migrations |
| 修正后第二次 `pnpm db:migrate` | 0 | 幂等执行，仅输出 schema/relation 已存在 NOTICE |
| 第一次 `pnpm test:pg` | 1 | 测试环境未加载 `TEST_DATABASE_URL` |
| 第二次 `pnpm test:pg` | 1 | 68/70 通过；2 项缺 Playwright Chromium |
| 安装 Chromium 后 `pnpm test:pg` | 0 | 14/14 文件、70/70 测试通过 |
| `pnpm typecheck` | 0 | M3 临时排除已移除，真实 M4 依赖通过 |

### `verify:v3` 非门禁结果

`pnpm verify:v3` 退出码 1，按计划不作为 Stage A 门禁且不据此重构复制代码：

- 3 个 PurpleInk 既有营销文件超过其 350 行 CVC 架构阈值。
- 报告列出 3 个直接 OpenAI client import，均在复制的 AI/render adapter 内。
- 报告列出 15 个 Canvas → DB 直接 import，属于复制代码的既有目录责任划分。
- 未发现 Trigger task import、Agent SDK package/import 或 U+FFFD。

## M5 路由并存

执行时间：2026-07-25

### 双入口与 worker 命名空间

- 营销首页移动到 `src/app/(marketing)/page.tsx`，公开路径仍为 `/`。
- CVC `(app)` 路由组通过 `robocopy /E` 原样复制到
  `src/app/legacy/(app)`；`AppShell` 只在该路由组的 `layout.tsx` 挂载。
- CVC 工作台、项目、画布、分镜、导出、设置分别发布在
  `/legacy`、`/legacy/projects`、`/legacy/canvas`、
  `/legacy/canvas/shot/[id]`、`/legacy/canvas/export`、
  `/legacy/settings`。
- `playbook` 原样复制到 `/playbook`，不带 `AppShell`。
- CVC 侧边栏、新建项目跳转和页面内深链均改为 `/legacy/*`；导航测试先红后绿，
  最终 2 个测试文件、17 项测试通过。
- Next rewrite 从宽泛的 `/api/:path*` 收窄为 `/api/engine/:path*`；
  CVC 的 Next API 继续使用 `/api/projects`、`/api/settings`、
  `/api/artifacts/[id]` 等原路径。营销 worker 客户端默认基址改为
  `/api/engine`。

### 真实运行验收

验收使用生产构建、Next `3000`、worker `8787` 和目标仓库独立 Postgres
`54328`。由于本次不依赖外部站点可用性，worker 使用
`BROWSER_DRIVER=mock` 与 `PURPLEINK_COMPOSE_MODE=template`，记录为
`KNOWN-ENV-BLOCK` 的允许降级；渲染、轮询、视频下载仍走真实本地 worker 与
HyperFrames。

| 检查项 | 结果 | 证据摘要 |
| --- | --- | --- |
| `GET /api/engine/health` | 200 | `ok=true`，rewrite 到 worker 成功 |
| 营销 Launch Composer | 通过 | 浏览器真实点击；任务 `127ddc4a-52ec-4e03-95ba-8c98a2174a2e` 完成，`hasVideo=true`，耗时 132.4 秒 |
| 视频端点 | 200 | `video/mp4`，15.000 秒，352987 bytes；浏览器自动下载 `purpleink-localhost.mp4` |
| HyperFrames 结果 | 完成 | `goldenVerified=true`；静态 check 有告警，UI 如实显示且未伪装通过 |
| 真实 PG 项目 | 通过 | 项目 `292ad565-99ab-46d3-98d0-b83af8cf4a1a`，`/legacy/canvas` 显示 4 个真实节点 |
| 设置页 | 通过 | 显示未配置状态与真实路由；API 只返回描述字段，未返回明文或密文 |
| 验收产物 | 200 | `/api/artifacts/c5dcb510-5e88-451b-9082-6b01eb7d13f2` 下载哈希与本地存储一致 |
| `/playbook` | 200 | Foundations、UI、Icons 三个入口可见 |

验收过程中发现 worker 还会上报 `scripting`、`synthesizing`、`timing`，
而营销进度组件原先未覆盖这些阶段，导致 250ms 定时器重复抛错。新增
`tests/job-phase-contract.test.ts` 先复现失败，再统一前端 `JobPhase`、
阶段标签和进度区间。修复后的完整任务从语音合成到完成仅保留基线已知的
`favicon-16x16.png` 404，无阶段映射异常。

截图证据：

- `docs/migration/evidence/m5-marketing.png`
- `docs/migration/evidence/m5-marketing-job-done.png`
- `docs/migration/evidence/m5-legacy-canvas.png`
- `docs/migration/evidence/m5-legacy-settings.png`
- `docs/migration/evidence/m5-playbook.png`

### M5 退出门

| 命令或检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run src/features/navigation/app-shell.test.ts src/features/navigation/app-sidebar-shell.test.ts` | 17/17 通过 |
| `pnpm exec vitest run tests/job-phase-contract.test.ts` | 1/1 通过 |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过，双入口、六个 legacy 页面、四个 playbook 页面和 API 路由全部产出 |
| U+FFFD 扫描 | 0 |

## M6 统一路由骨架

执行时间：2026-07-25

### 规范与实现结构

- 将来源仓库 `docs/conventions/新路由统一规范.md` 按字节一致复制为
  `docs/conventions/routing.md`，再补充路由文件映射、六步守卫矩阵和
  `shell` / `wired` / `legacy` 实现状态表。
- 新路由统一放在 `src/app/(product)`，由 `ProductAppShell` 提供
  Dashboard、Products、Releases、Login 的真实导航入口。
- `UnwiredPanel` 统一展示精确文案“该页尚未接线（Stage B）”、未来进入前置和
  未来数据来源；不展示假统计、假进度、假审批或连接状态。
- `ReleaseStepNav` 只维护 Brief → Flow → Evidence → Storyboard → Review →
  Artifacts 六步，使用编码后的 `releaseId` 构造链接，并只给当前步骤设置
  `aria-current="step"`。
- `/login` 与 `/signup` 只渲染禁用的表单外观和未接线说明，不提交凭据、不推断会话，
  注册页也不创建示例 Product/Release。
- 所有动态页面均 `await params`；全部 `page.tsx` 不超过 200 行。

### 路由验收

生产构建下逐条请求 12 条正式新路由，全部返回 200：

`/login`、`/signup`、`/dashboard`、`/products`、
`/products/product-acceptance`、`/releases`，以及
`/releases/release-acceptance/{brief,flow,evidence,storyboard,review,artifacts}`。

旧路由结果：

| 旧路由 | 状态 | Location |
| --- | ---: | --- |
| `/releases/release-acceptance/sources` | 308 | `/releases/release-acceptance/evidence` |
| `/releases/release-acceptance/render` | 308 | `/releases/release-acceptance/artifacts` |

`/legacy/*` 未增加任何重定向，M5 的 CVC 页面继续可访问。

### TDD 与浏览器证据

- `tests/m6-route-shells.test.tsx` 首次因共享组件不存在而失败。
- 实现共享组件后，组件真值测试通过、14 个路由文件清单继续失败。
- 页面与重定向文件落盘后，路由文件、规范表一致性、六步链接/单步高亮、
  Stage B 文案与数据来源共 4/4 通过。
- Chromium 打开 `/releases/release-acceptance/evidence`，显示六步导航、
  `CaptureRun` / `NodeEvidence` 等未来来源和明确未接线文案；点击 Review 后 URL
  与页面内容同步更新，DOM 中只有 `05Review` 一项带 `aria-current="step"`。
- 浏览器控制台仅保留基线已知的 `favicon-16x16.png` 404。
- 截图：`docs/migration/evidence/m6-evidence-shell.png`。

### M6 退出门

| 命令或检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run tests/m6-route-shells.test.tsx` | 4/4 通过 |
| 12 条正式路由 HTTP 验收 | 12/12 返回 200 |
| 2 条旧路由 | 2/2 返回 308，Location 正确 |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过，构建路由表与规范一致 |
| 页面行数 | 全部 `page.tsx` ≤ 200 行 |

## M7 收口与交接

执行时间：2026-07-25

### 仓库入口与开发约束

- 新增根 `AGENTS.md`，登记 UTF-8/中文保护、本地分阶段提交、无授权不 push/PR、
  当前路由边界、pnpm workspace、Postgres/Artifact 真值、安全配置、文件规模和
  完整门禁。
- 重写根 `README.md`，移除初始文档中的乱码和已经失效的 npm/旧目录说明，改为
  Stage A 的真实入口、启动方式、目录结构、路由状态与未接线边界。
- `.env.local`、`.data/`、`out/`、`output/`、`node_modules`、npm lockfile
  均未进入跟踪；仓库只跟踪值为空的 `.env.example` 与
  `config/tts.env.example`。
- `AGENTS.md`、`README.md`、`docs`、`src`、`server`、`scripts`
  的 U+FFFD 扫描结果为 0。

### 测试分区与显式排除

将 `src/features/audio/runtime-repository.test.ts` 改名为
`runtime-repository.pg.test.ts`。该测试会访问真实 Postgres，现在只由
`pnpm test:pg` 串行执行，不再混入默认单元测试。

默认 `pnpm test` 继续显式排除下列历史契约：

| 排除项 | 原因 |
| --- | --- |
| `src/features/director/pi-session.test.ts` | 绑定已作废 Pi runtime；Stage A 的生产入口稳定抛 `NOT_AVAILABLE_STAGE_A` |
| `src/features/director/session-store.test.ts` | 绑定已作废 Pi JSONL session store |
| `src/features/pipeline/contracts/contracts.test.ts` | 绑定已作废 Trigger 队列 |
| `src/features/pipeline/contracts/task-source-boundary.test.ts` | 验证已移除的 Trigger task source |
| `src/lib/db/runtime-boundary.test.ts` | 验证本 Goal 明确不保留的 SQLite runtime |
| `**/*.pg.test.ts` | 统一交给 `pnpm test:pg`，避免数据库测试并发污染 |

这些排除不是把现行失败藏起来：对应生产能力已经从 Stage A 边界中明确移除或显式
不可用；其余默认测试 88 个文件、384 项全部执行通过，Postgres 测试 15 个文件、
72 项全部执行通过。`tests/env.test.ts` 同步到当前 `src/lib/site-config.ts`
边界，并确认敏感环境变量示例存在但值为空。`next.config.ts` 将
`ffmpeg-static` 声明为服务端外部包，满足构建和既有配置契约。

### 最终门禁

| 命令或检查 | 最终结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 88 files / 384 tests 通过 |
| `pnpm test:pg` | 15 files / 72 tests 通过 |
| `pnpm build` | 通过，营销、legacy、playbook、产品路由壳和 API 均产出 |
| `pnpm db:migrate` 第一次 | 退出码 0 |
| `pnpm db:migrate` 第二次 | 退出码 0，验证迁移幂等 |
| `git diff --check` | 通过 |
| U+FFFD 扫描 | 0 |
| 跟踪文件敏感路径检查 | 未发现 `.env.local`、运行数据、输出目录或 npm lockfile |

一次把 build、默认测试和 PG 测试并行执行的审计中，
`src/lib/queue/init.test.ts` 因机器高并发负载超过 5 秒超时。记录为
`KNOWN-VERIFY-CONTENTION`；不调高超时、不隐藏测试，随后按项目门禁顺序串行重跑，
同一默认测试集在 11.76 秒内 384/384 通过，PG 测试在 33.42 秒内 72/72 通过，
lint、typecheck 与 build 也分别重新通过。上表采用这组无资源争用的串行证据。

`pnpm verify:v3` 仍是 M4 已登记的非门禁诊断：复制的 CVC 架构阈值与 PurpleInk
既有营销文件并不完全一致，本 Goal 没有借收口扩大为无关重构。

### 依赖、版本与发布审计

- 根与 `server/` manifest、生产 import 以及
  `pnpm list --recursive --depth 0 --json` 均未发现 Trigger、Pi 或
  `better-sqlite*` 运行依赖。
- HyperFrames manifest 和 workspace 本地 CLI 均为 `0.7.70`。
- 目标分支没有 remote、upstream，也没有执行 push、PR 或远端写入。
- 所有提交均为本地分阶段 Conventional Commit。

### 来源仓库只读核对

来源 HEAD 在 M0 与 M7 均为
`0fd1800d4052ff824ca0a14402d3e6bd14116160`。本次执行对来源仓库只进行
读取、状态检查和复制单个路由规范文件，没有执行写入或来源 Git 变更命令。

收口时发现来源工作区相较 M0 基线出现 `SOURCE-WORKTREE-DRIFT`：
状态汇总为 8 个删除、141 个修改、12 个未跟踪项，新增变化集中在
`.qoder/repowiki` 生成内容；M0 已存在的 pipeline 修改/未跟踪项仍在。该漂移在
本次长时执行期间由外部产生，HEAD 未变；为遵守只读边界，本次没有清理、还原或
提交任何来源文件。因此只能证明“本执行未写来源且 HEAD 不变”，不能虚构为
“来源工作区状态逐项一致”。

### 本地阶段提交

| 阶段 | 本地提交 |
| --- | --- |
| 基线 | `1d41aa5 chore: baseline before cvc merge`，tag `pre-merge-baseline` |
| M0 | `84237bf docs: record m0 migration baseline` |
| M1 | `8328511 refactor: move purpleink web into src layout` |
| M2 | `7b9a270 build: unify workspace tooling with pnpm` |
| M3 | `98da54f feat: import cvc design system foundation` |
| M4 | `1da0927 feat: import cvc postgres domain layer` |
| M4 配置边界 | `6b3d083 chore: scope env example tracking` |
| M5 | `7c37b21 feat: add dual marketing and legacy runtimes` |
| M6 规范 | `f224893 docs: define product route shell contract` |
| M6 计划 | `d72cd3b docs: plan m6 product route shells` |
| M6 实现 | `883504b feat: add product workflow route shells` |
| M7 | `chore: close stage a migration`（本报告所在最终本地提交） |

### Stage B 建议优先级

1. **P0 — 新域与访问边界**：落地 Product、Release、Workspace 聚合及认证/授权，
   先定义真实 repository、ownership 和访问守卫，再让当前路由壳读取数据。
2. **P1 — 六步审批与版本守卫**：为 Brief、Flow、Evidence、Storyboard、
   Review 建立可审计版本、审批、不变性与回退规则，禁止仅靠 UI 状态推进。
3. **P2 — 引擎与证据接线**：把 Product/Release 连接到真实 worker、
   `CaptureRun`、`NodeEvidence` 与 Artifact lineage，保留失败和降级证据。
4. **P3 — 过渡域迁移**：设计 CVC Project/Canvas 到新域的投影或迁移策略，
   不直接把 legacy schema 冒充 Product/Release。
5. **P4 — 退役过渡入口**：只有在功能、数据和浏览器证据达到等价后，才逐步退役
   `/legacy/*` 与 `/playbook/*`；退役前继续保持可访问且明确标注其过渡性质。

M0–M7 至此完成。Stage A 的营销链路、worker、真实 Postgres/CVC 过渡域、
Playbook 与新路由壳均在各自声明边界内可验证；Stage B 壳没有被伪装成已接线产品。
