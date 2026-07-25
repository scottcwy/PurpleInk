# PurpleInk + CodeVideoCanvas Stage A 迁移报告

> 执行分支：`feature/merge-cvc`
> 基线标签：`pre-merge-baseline`
> 目标仓库：`D:\projects\Dev-Tools\PurpleInk-dev`
> 只读来源：`D:\projects\Dev-Tools\CodeVideoCanvas`

## 执行原则

- 本报告只记录真实执行结果；失败项不会改写为成功。
- 未接线页面必须显式标注，不使用假数据、假进度或恒真状态。
- 敏感配置只记录变量名，不记录或提交其值。
- 来源仓库只读；最终以迁移前后的 Git 状态一致性自证未写入。

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

待执行。

## M3 CVC 视觉层与基础库

待执行。

## M4 CVC 数据层与业务后端

待执行。

## M5 路由并存

待执行。

## M6 统一路由骨架

待执行。

## M7 收口与交接

待执行。
