# src/app 路由树

本文件是 `src/app` 目录的现状快照，供代理快速定位。**规范真值在 `docs/conventions/routing.md`**；本文件只描述「现在长什么样、每个文件干什么」。两者冲突时以规范为准，并在同一次改动中回写本文件。

最后同步：2026-07-25。

## 1. 目录形状

```text
src/app/
├── layout.tsx                  根 layout：字体、主题脚本、Providers、SkipToContent
├── not-found.tsx               根级 404（无侧栏）
├── global-error.tsx            根级兜底错误页（自带 html/body）
├── robots.ts                   /robots.txt
├── sitemap.ts                  /sitemap.xml
├── globals.css                 Tailwind 入口，import design-system.css
├── design-system.css           ds-* token 与 ds-app-gradient 等工具类
├── favicon.ico / icon.svg / apple-icon.svg
│
├── _components/                跨路由组共用的 C 层组合（非路由）
│   ├── route-status.tsx        404 / 错误页共用的状态面板
│   ├── unwired-panel.tsx       未接线占位面板
│   ├── route-shell-page.tsx    未接线路由的整页壳
│   ├── new-project-dialog.tsx  新建项目模态（'use client'）
│   └── new-project-api.ts      新建项目的 fetch 封装
│
├── (marketing)/                L1 营销
│   └── page.tsx                → /
│
├── (public)/                   L1 公开只读
│   ├── layout.tsx              公开壳，无侧栏、无写操作
│   └── release/page.tsx        → /release（占位）
│
├── (auth)/                     L2 认证
│   ├── layout.tsx              认证壳，无侧栏
│   ├── _components/auth-shell-form.tsx
│   ├── login/page.tsx          → /login（未接线）
│   └── signup/page.tsx         → /signup（未接线）
│
├── products/                   L3 制作应用
│   ├── page.tsx                → /products，308 到 /products/dashboard
│   └── (app)/                  唯一应用壳挂载点
│       ├── layout.tsx          挂 AppShell（常驻侧栏）
│       ├── loading.tsx         段级骨架
│       ├── template.tsx        内容区入场动画（'use client'）
│       ├── not-found.tsx       段级 404，侧栏保留
│       ├── error.tsx           段级错误边界，侧栏保留（'use client'）
│       ├── dashboard/          → /products/dashboard
│       ├── projects/           → /products/projects
│       ├── canvas/[projectId]/ → /products/canvas/:projectId
│       ├── shots/[shotId]/     → /products/shots/:shotId?projectId=
│       ├── export/[projectId]/ → /products/export/:projectId
│       └── settings/           → /products/settings?projectId=
│
├── playbook/                   L4 组件登记
│   ├── registry.ts             PLAYBOOK_ENTRIES（ui / icons）
│   ├── page.tsx                → /playbook
│   └── {ui,icons,foundations}/page.tsx
│
└── api/                        Next 自有 API
    ├── ping/route.ts
    ├── projects/route.ts · projects/[id]/route.ts
    ├── artifacts/[id]/route.ts
    ├── jobs/[id]/route.ts
    ├── render/route.ts · render/export/route.ts · render/thumbnails/route.ts
    ├── director/pipeline/route.ts · director/stage/route.ts
    ├── director/stream/[nodeId]/route.ts   SSE
    └── settings/route.ts
```

## 2. 命名约定速查

| 写法 | 出现在 URL 里 | 含义 |
| --- | --- | --- |
| `products` | 是 | 普通路径段 |
| `(marketing)` | 否 | 路由组：只为共用 layout 分组 |
| `[projectId]` | 是，作为变量 | 动态段 |
| `_components` | 否，且不是路由 | 私有目录，Next 跳过 |

## 3. 四层与壳的对应

| 层 | 路由组 | 壳 | 侧栏 | 认证 | 可索引 |
| --- | --- | --- | --- | --- | --- |
| L1 公开 | `(marketing)`、`(public)` | 营销壳 / 公开只读壳 | 无 | 匿名 | `/` 是；`/release` 否 |
| L2 认证 | `(auth)` | 认证壳 | 无 | 匿名 | 否 |
| L3 制作应用 | `products/(app)` | `AppShell` | 常驻 | 目标必须登录，**当前无认证** | 否 |
| L4 内部 | `playbook` | 无业务壳 | 无 | 目标仅非生产 | 否 |

L3 的壳只有一处实现：`src/features/navigation/app-shell.tsx`。`(auth)` 与 `(public)` 的 layout 里禁止出现 `AppShell` 或任何 Sidebar，这条有测试守着（`tests/app-route-contract.test.tsx`）。

## 4. 接线状态

`wired` = 有真实数据与操作链路；`shell` = 路由与导航存在但未接线，页面显式声明未接线与未来数据来源；`planned` = 规范已定、代码未落盘。

| 路由 | 状态 | 说明 |
| --- | --- | --- |
| `/` | `wired` | 营销页。**已知缺口**：header / footer 链接全是 `#` 或空串，没有进入 L3 或 `/login` 的入口 |
| `/products/dashboard` | `wired` | `listProjects()` + `getCanvasGraph()` 真实统计与最近项目 |
| `/products/projects` | `wired` | 真实项目列表 |
| `/products/canvas/[projectId]` | `wired` | 真实 DAG，节点动作打 `/api/director/*` 与 `/api/render` |
| `/products/shots/[shotId]` | `wired` | 真实镜头合同与产物；`projectId` 缺失即 404 |
| `/products/export/[projectId]` | `wired` | 真实导出就绪度与成片 Artifact |
| `/products/settings` | `wired` | 凭据先验证后保存，失败返回 422 不覆盖 |
| `/playbook/*` | `wired` | 40 个 UI 组件族 + 1 icons（`patterns` 分类已于 ISSUE-007 移除；计数以 `UI_COMPONENT_FAMILY_COUNT` 为准） |
| `/login`、`/signup` | `shell` | 表单外观，输入与提交全部 disabled |
| `/release` | `shell` | 单页占位，禁止提前落子路由 |
| `/artifacts`、`/artifacts/[caseSlug]`、`/share/[shareId]` | `planned` | 依赖尚未建立的 `ShareSnapshot` 模型，见规范 §8 |

## 5. 上下文参数

`projectId` 是制作侧唯一主上下文，必须从 URL 取得，不得从客户端全局状态或 `localStorage` 推断。

| 路由 | 上下文位置 | 缺失时 |
| --- | --- | --- |
| `canvas/[projectId]` | path | `notFound()` |
| `export/[projectId]` | path | `notFound()` |
| `shots/[shotId]` | `shotId` path + `projectId` query（必填） | `notFound()` |
| `settings` | `projectId` query（可选） | 渲染账号级设置 |

所有 L3 链接由 `src/features/navigation/products-routes.ts` 生成，页面禁止手写 `/products/...` 模板字符串。侧栏取 `projectId` 的优先级是 `searchParams` → `NavContext` → `undefined`；服务端页面用 `<PublishNavContext />` 把已校验的 id 交给常驻侧栏。

## 6. 错误与未找到边界

| 文件 | 触发 | 壳 |
| --- | --- | --- |
| `not-found.tsx` | URL 未匹配；无更近边界的 `notFound()` | 全屏，无侧栏 |
| `products/(app)/not-found.tsx` | L3 各页显式 `notFound()` | `AppShell` 内，侧栏保留 |
| `products/(app)/error.tsx` | L3 未处理异常，带 `reset` | `AppShell` 内，侧栏保留 |
| `global-error.tsx` | root layout 失效 | 自带 `html`/`body`，无 Providers |

四者共用 `_components/route-status.tsx`。规则：只展示错误类别与 `error.digest`，不回显 message、堆栈或 provider 原始响应；404 文案不区分「不存在」与「无权访问」。

## 7. API 边界

`src/app/api/**` 只做参数解析、鉴权与响应映射，业务逻辑在 `src/features/*`。

- 状态码固定语义：400 参数非法、404 不存在或不属于当前作用域、409 状态冲突、422 外部凭据校验失败。
- 除 `/api/ping` 外全部 `dynamic = 'force-dynamic'`。
- `/api/engine/*` 不在本目录，由 `next.config.ts` rewrite 到 worker（默认 `http://localhost:8787`）。
- 资源 URL 合同：Artifact 下载 `/api/artifacts/{id}?projectId={id}`；日志流 `/api/director/stream/{nodeId}?projectId={id}`；worker 视频 `${API_BASE}/jobs/{jobId}/video`。所有片段必须 `encodeURIComponent`。

## 8. 当前已知问题

1. **无认证。** 没有 `proxy.ts`，全部页面与 API 都不读 session，workspace 固定 `LOCAL_WORKSPACE_ID`。`/products/*` 与 `/api/*` 目前未授权可访问，只能跑在本地或受信网络内。
2. ~~`robots.ts` 缺 `/share/` disallow~~ 已修复（ISSUE-009）。
3. `sitemap.ts` 只有 `/` 一条；`/artifacts` 与 featured 案例待 `ShareSnapshot` 落盘后接入（见 `sitemap.ts` 注释）。
4. ~~`canvas-inspector.tsx` 拼 artifact href 时 `projectId` 未 `encodeURIComponent`~~ 已修复（ISSUE-009）。
5. `/playbook/foundations` 有页面但不在 `PlaybookCategory` 里。
6. `shot-detail.tsx`（525 行）与 `export-workspace.tsx`（389 行）超出行数门禁，`pnpm verify:v3` 因此为红。
7. ~~`font-sc` class 全仓库未定义~~ 已删除（ISSUE-009）。

## 9. 相关文档

| 文档 | 责任 |
| --- | --- |
| `docs/conventions/routing.md` | 路由规范真值：分层、URL 形状、守卫、状态码 |
| `docs/designs/Design-system-inventory.md` | token、组件、Pencil 页面合同 |
| `AGENTS.md` | 执行前提、规模门禁、验证与提交要求 |
| `tests/app-route-contract.test.tsx` | 本文件第 1、3、4 节的可执行契约 |
