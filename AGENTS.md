# AGENTS.md — PurpleInk Stage A

本文件是本仓库的代理执行入口。所有文本保持 UTF-8，禁止引入 U+FFFD replacement character 或破坏中文。仓库使用 Git；每个可独立验证的阶段必须做本地 Conventional Commit。未经用户明确授权，不得 push、创建 PR、force push 或改写远端。

## 1. 当前产品边界

PurpleInk Stage A 在一个 Next.js 应用中同时提供：

- `/`：PurpleInk 营销页与本地出片入口；
- `/api/engine/*`：反向代理到 `server/` 渲染 worker；
- `/legacy/*`：CodeVideoCanvas 过渡页面，读取真实 Postgres 数据；
- `/playbook/*`：CVC 组件登记与展示；
- `/login`、`/signup`、`/dashboard`、`/products*`、`/releases*`：Stage B 新规范路由壳。

新规范路由壳不得接假数据库、假认证或假引擎。未接线页面必须明确显示“该页尚未接线（Stage B）”及未来数据来源。`/legacy/*` 是过渡资产，不应被描述成新的 Product/Release 域模型。

## 2. 目录与公开边界

```text
src/
  app/                  页面、layout 与 Next API 薄入口
    (marketing)/        营销首页
    (product)/          Stage B 产品路由壳
    legacy/(app)/       CVC 过渡应用
    playbook/           组件登记页面
    api/                Next 自有 API
  components/
    marketing/          PurpleInk 营销组件
    ui/                 共享 UI 原语
  features/             canvas、artifact、render、audio、AI 等领域能力
  lib/                  数据库、存储、队列、配置与基础设施
server/                 PurpleInk 渲染 worker
scripts/                数据库、验证与迁移脚本
tests/                  跨目录契约与 Stage A 测试
docs/                   路由规范、迁移报告与证据
```

- TypeScript `@/*` 只映射到 `./src/*`。
- 默认使用 Server Component；`'use client'` 下沉到确有交互需求的叶子组件。
- Next 16 的 `params`、`searchParams`、`cookies`、`headers` 必须 `await`。
- 跨域复用现有公开导出；避免为同一职责增加平行 wrapper、第二套状态模型或纯 re-export 壳。
- `src/app` 只做参数解析、组合与响应映射，不放 SQL、渲染参数或复杂业务状态机。

## 3. 包管理与运行方式

唯一包管理器是 pnpm 10.30.0。根目录与 `server/` 由 `pnpm-workspace.yaml` 管理；不要生成或提交 `package-lock.json`，不要手工修改 `pnpm-lock.yaml`。

```powershell
pnpm install
pnpm dev
pnpm dev:worker
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
```

- Next 默认监听 `http://localhost:3000`。
- worker 默认监听 `http://localhost:8787`。
- 本地 Postgres 默认由目标仓库 Docker Compose 提供；若端口冲突，以 `.env.local` 和迁移报告登记的实际端口为准。
- HyperFrames 必须使用 workspace 本地固定版本，不允许运行时动态下载 CLI。

## 4. 数据、Artifact 与 UI 真值

- Postgres 是当前结构化业务数据源；不得新增 SQLite 运行依赖或双写路径。
- approved/released Artifact 不可原地更新或删除；新版本使用新记录并保留 lineage。
- `content_hash` 必须来自实际字节的 SHA-256；文件大小、状态、版本与来源不能伪造。
- 凭据只存加密内容；master key 只从 server-only 环境读取，不得明文 fallback。
- UI 可见字段必须可追溯到 API、数据库投影、Artifact 或明确的 Stage B 占位。
- 禁止固定假百分比、恒真成功/QA、无 Artifact 的下载链接、可点击但无行为的业务按钮。
- fixture、mock、真实 API/模型调用必须分别标注；mock 渲染不能宣称为真实外部站点采集。

## 5. 密钥与本地文件

代理可以为本地验证读取 `.env.local`，但只允许在报告、日志和对话中引用变量名：

- 不回显 secret 值；
- 不写入源码、测试 fixture、截图、日志或 commit；
- 不创建携带 secret 的 `NEXT_PUBLIC_*` 变量；
- `.env.local`、`.data/`、`out/`、`output/`、构建产物和浏览器临时目录不得提交；
- 设置 API 先验证再保存，验证失败不得覆盖已有凭据。

## 6. 文件与函数规模

- `page.tsx` 目标不超过 200 行，硬上限 300 行；
- 一般生产文件目标不超过 250 行，硬上限 350 行；
- schema/repository 按聚合拆分，硬上限 400 行；
- 单函数目标不超过 50 行；
- 文件只承担一个主要变化原因。达到硬上限或职责混杂时，按真实 domain/application/infrastructure/UI 边界拆分并复用公共代码，不能用循环依赖或空壳文件规避行数。

## 7. 验证与提交

功能和修复遵循 RED → GREEN → 重构 → 验证。完成前至少运行：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:pg
pnpm build
git diff --check
```

并按变更范围补充：

- Postgres migration 连续执行两次；
- `/api/engine/*` 与 Next `/api/*` 的 HTTP 证据；
- 用户可见页面的真实 Chromium 截图与控制台检查；
- 视频产物的 `ffprobe`、实际文件哈希和可下载验证；
- `AGENTS.md README.md docs src server scripts` 的 U+FFFD 扫描；
- 禁止依赖、未跟踪 secret 和 staged scope 检查。

提交前检查 `git diff --cached --name-status`，只提交当前职责的文件。禁止用 `git reset --hard`、`git checkout --` 或覆盖式命令清除用户改动。

## 8. 当前权威文档

- `docs/conventions/routing.md`：新规范路由、守卫与实现状态。
- `docs/migration/stage-a-report.md`：M0–M7 迁移事实、waiver、命令与运行证据。
- `docs/superpowers/plans/2026-07-25-m6-route-shells.md`：M6 路由壳实施清单。
