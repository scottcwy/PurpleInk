# PurpleInk

## AdventureX 参赛说明（请先读）

本仓库是 **AdventureX** 参赛项目 **PurpleInk**。

比赛期间队员按两个方向同步推进，再合并到本仓库交付：

| 方向 | 负责 | 说明 |
| --- | --- | --- |
| 工作流 / 节点画布 | 羽升 | 比赛开始后新建对照仓 [AIMFllyYS/code-video-canvas](https://github.com/AIMFllyYS/code-video-canvas)；评委如需对照独立演进过程可查看该仓 |
| 前端设计 | 燕耳 Firenze | 产品界面与视觉设计 |
| 后端 | DeepSuck | 服务端、采集与出片链路 |
| 产品运营 | Annie.Y | 产品与运营 |

**两板块合并后的交付分支是 `yusheng/two-part-merge`。**  
请评委与协作者检出该分支查看合并结果。

> **禁止直接合并到 `main` / `master`。**  
> 云端协作与评审只通过 `yusheng/two-part-merge`（或基于它的 PR）进行，不得把本合并线强推/直合进默认主分支。

---

## 产品概览

PurpleInk 是把脚本、录音或公开网站转成发布视频的工作区。Next.js 应用负责项目、
画布、模型网关、账本与 Artifact，独立 worker 负责采集、媒体处理和渲染。

## 当前可用入口

| 入口 | 状态 | 说明 |
| --- | --- | --- |
| `/` | 已接线 | PurpleInk 营销页 |
| `/api/engine/*` | 已接线 | Next 同源反代到 `server/` worker |
| `/products/*` | 已接线 | 项目、画布、镜头、导出、计费与设置，读取真实 Postgres/Artifact/队列 |
| `/playbook/*` | 已接线 | 设计系统组件登记与视觉验收 |
| `/login`、`/signup` | 已接线 | 账号会话入口 |

完整路由、守卫和状态见 [routing.md](docs/conventions/routing.md)，迁移事实与验收证据见 [stage-a-report.md](docs/archive/migration/stage-a-report.md)（历史记录，只供追溯）。

## 工作流排障

Director / 渲染 / 音频 / 模型路由这条链路的复发失败模式、取证顺序与已落地护栏，
统一记录在 [workflow-failure-patterns.md](docs/conventions/workflow-failure-patterns.md)。

阶段失败时先看那份文件的 §1：画布弹窗里的文案是脱敏投影，原始报文在
`task_attempts.failure.message`。改动阶段合同、错误分类或节点类型映射前，
按 §8 的清单逐条自检；新发现的同类失败追加为新模式，不要另建文件。

三来源状态机、停止/恢复和 Artifact 边界见
[project-workflows.md](docs/conventions/project-workflows.md)；路由与统一执行快照见
[routing.md](docs/conventions/routing.md)。日常只读完整性检查使用 `pnpm verify:workflow`；
恢复脚本默认 dry-run，只有按运行手册保存快照后才使用 `--apply`。

## 环境要求

- Node.js 22
- pnpm 10.30.0
- Docker Desktop（用于本地 Postgres）
- FFmpeg / ffprobe

## 安装与启动

```powershell
pnpm install
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm dev
```

另开一个终端启动渲染 worker：

```powershell
pnpm dev:worker
```

默认地址：

- Web：`http://localhost:3000`
- Worker：`http://localhost:8787`
- Worker 同源健康检查：`http://localhost:3000/api/engine/health`

本地配置写入被 Git 忽略的 `.env.local`。只复制 `.env.example` 中的变量名并在本机填写，禁止提交或回显 secret。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript 严格检查 |
| `pnpm test` | 默认单元与契约测试 |
| `pnpm test:pg` | 串行 Postgres 集成测试 |
| `pnpm build` | Next 生产构建 |
| `pnpm db:migrate` | 应用 Postgres migrations |
| `pnpm verify:v3` | 架构、规模、禁用依赖与编码门禁 |
| `pnpm verify:workflow` | 只读检查 attempt、invocation、epoch、lease/ticket 与 Artifact 完整性 |
| `pnpm recover:workflow` | 默认 dry-run 的可变孤儿恢复；`--apply` 需按运行手册执行 |

## 目录结构

```text
src/
  app/
    (marketing)/          PurpleInk 营销首页
    products/(app)/       制作应用：项目、画布、镜头、导出、设置
    playbook/             组件登记页面
    api/                  Next 自有 API
  components/
    marketing/            营销组件
    ui/                   共享 UI 原语
  features/               canvas、artifact、render、audio、AI 等领域能力
  lib/                    DB、storage、queue、config 等基础设施
server/                   PurpleInk 渲染 worker
scripts/                  数据库与验证脚本
tests/                    跨目录契约测试
docs/                     路由规范、迁移报告和浏览器证据
```

TypeScript 别名 `@/*` 映射到 `src/*`。仓库使用 pnpm workspace 管理根应用与 `server/`，不要生成 npm lockfile。

## 生产部署

生产部署只走 Zeabur Git 构建：架构决策见
[zeabur-plan.md](docs/deployment/zeabur-plan.md)，部署与运维见
[zeabur-setup.md](docs/deployment/zeabur-setup.md)。结构化数据真值是
PostgreSQL 17.5；Artifact 字节与 PostgreSQL 备份归档持久化在 Cloudflare R2。
集成账本见 [zeabur-predev-integration-2026-08-02.md](docs/integration/zeabur-predev-integration-2026-08-02.md)。

## 生产边界

- `/products/*` 使用真实 Postgres、Artifact、队列与内部 AI/worker 网关；未接线能力必须显式标注。
- 三类来源保留各自 DAG，但共用 attempt、execution epoch、执行计划、账本与快照合同。
- 本地 mock 采集必须明确标注，不能宣称为真实外部网站采集。
- UI 不得显示假统计、假进度、恒真成功或没有真实 Artifact 的下载入口。
- Artifact 内容哈希来自实际字节；凭据只在服务端使用且不进入 Git。

详细开发纪律见 [AGENTS.md](AGENTS.md)。
