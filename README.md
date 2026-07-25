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

## Stage A 概览

PurpleInk 是一个本地优先的产品发布视频工作区。当前 Stage A 把营销出片链路、CodeVideoCanvas 过渡应用、组件 Playbook 和新 Product/Release 路由骨架合并在一个 Next.js 仓库中。

## 当前可用入口

| 入口 | 状态 | 说明 |
| --- | --- | --- |
| `/` | 已接线 | PurpleInk 营销页；可向本地 worker 发起出片任务 |
| `/api/engine/*` | 已接线 | Next 同源反代到 `server/` worker |
| `/legacy/*` | 过渡应用 | CVC 工作台、项目、画布、导出和设置，读取 Postgres |
| `/playbook/*` | 过渡应用 | CVC 组件登记与展示 |
| `/login`、`/signup`、`/dashboard` | 路由壳 | 明确标注 Stage B 未接线 |
| `/products*`、`/releases*` | 路由壳 | Product/Release 新规范与六步导航，不含假数据 |

完整路由、守卫和状态见 [routing.md](docs/conventions/routing.md)，迁移事实与验收证据见 [stage-a-report.md](docs/migration/stage-a-report.md)。

## 环境要求

- Node.js 24
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
| `pnpm verify:v3` | 过渡架构诊断；Stage A 不作为门禁 |

## 目录结构

```text
src/
  app/
    (marketing)/          PurpleInk 营销首页
    (product)/            Stage B 产品路由壳
    legacy/(app)/         CVC 过渡页面
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

## Stage A 边界

- 新 Product/Release 页面只提供路由、导航、职责和未来数据来源，不做认证、审批、数据库或引擎接线。
- `/legacy/*` 仍是 CVC 过渡域，不等于新 Product/Release 域模型。
- 本地 mock 采集必须明确标注，不能宣称为真实外部网站采集。
- UI 不得显示假统计、假进度、恒真成功或没有真实 Artifact 的下载入口。
- Artifact 内容哈希来自实际字节；凭据只在服务端使用且不进入 Git。

详细开发纪律见 [AGENTS.md](AGENTS.md)。
