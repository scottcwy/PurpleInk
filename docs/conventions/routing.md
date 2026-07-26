# 前端路由规范

本文件是 PurpleInk 全部路由（页面、API、worker 代理）的唯一真值。新增或删除任何可寻址表面，必须先改本文件，再改代码。

## 0. 真值顺序

冲突时由上到下裁决：

1. **视觉与页面结构**：Pencil canonical 画板（`docs/designs/canvas.pen`），经 `docs/designs/Design-system-inventory.md` 的 S1–S6 合同表达。
2. **组件**：`/playbook` 已登记的组件族。页面不得本地拼装第二套视觉。
3. **URL 形状、上下文参数、守卫、状态码**：本文件。
4. **领域语义与字段**：`src/lib/db/schema/*` 与各 `src/features/*/index.ts` 公开导出。

2026-07-25 之前的 Release 六步规范（Brief / Flow / Evidence / Storyboard / Review / Artifacts）整体作废，摘要保留在 §12 供追溯，不再作为实现依据。

## 1. 路由分层

只允许存在四层。每层的壳、认证要求、数据来源、可索引性都不同。

| 层 | 前缀 | 壳 | 认证 | 可索引 | 用途 |
| --- | --- | --- | --- | --- | --- |
| L1 公开 | `/`、`/artifacts*`、`/share/*`、`/release` | 营销壳 / 只读分享壳 | 匿名 | `/`、`/artifacts*` 是；`/share/*` 否 | 获客、案例、对外分享 |
| L2 认证 | `/login`、`/signup`、`/password/reset` | 认证壳（无侧栏，左海报 + 右表单） | 匿名 | 否 | 进入 L3 |
| L3 制作应用 | `/products/*` | `AppShell` + `AppSidebarShell` | 必须登录（见 §9） | 否 | 全部真实制作功能 |
| L4 内部 | `/playbook/*` | 独立无业务壳 | 仅非生产环境 | 否 | 组件登记与视觉验收 |
| API | `/api/*` | 无 | 见 §4 | 否（robots 已 disallow） | 数据与引擎 |

硬约束：

- **L3 只允许一套壳。** `src/features/navigation/app-shell.tsx` + `app-sidebar-shell.tsx` + `app-sidebar.tsx` 是唯一实现。禁止再出现第二个 app shell、第二个 sidebar 组件或第二套 pathname→高亮映射。
- L1、L2 不挂 `AppSidebar`。分享页与案例页不得出现制作侧导航、项目切换器或任何写操作入口。
- L4 不在任何业务壳内，且不得被 L1/L3 页面链接。
- **滚动 Provider 按路由分层。** 根 `src/app/providers.tsx` 只负责全站主题协议；`src/app/(marketing)/layout.tsx` 独占营销动效与 Lenis。L2、L3、L4 和 L1 的非营销公开页使用原生滚动，禁止引用营销 Provider。
- **L3 的滚动归 AppShell 内部容器所有。** `AppShell` 保持全屏固定壳，各产品页面的 `main` 或领域面板负责自己的原生滚动；不得在根布局重新挂载会接管 wheel 事件的全局平滑滚动。

## 2. 页面路由表

状态口径：`wired` = 有真实数据与操作链路；`shell` = 路由存在但未接线，页面必须显式声明未接线与未来数据来源；`planned` = 本文件已定规范、代码未落盘；`redirect` = 仅 308；`retire` = 待删除。

### 2.1 L1 公开

| 路由 | 文件 | 状态 |
| --- | --- | --- |
| `/` | `src/app/(marketing)/page.tsx` | `wired` |
| `/artifacts` | `src/app/(public)/artifacts/page.tsx` | `planned` |
| `/artifacts/[caseSlug]` | `src/app/(public)/artifacts/[caseSlug]/page.tsx` | `planned` |
| `/share/[shareId]` | `src/app/(public)/share/[shareId]/page.tsx` | `planned` |
| `/release` | `src/app/(public)/release/page.tsx` | `shell` |

`(public)` 组的壳是 `src/app/(public)/layout.tsx`：无侧栏、无写操作入口。

`/` 右上角 **Try it** 已接线到 `PRODUCTS_ROUTES.projects`（`/products/projects`），是进入 L3 的主 CTA。未登录点击会被 §9 的守卫收敛到 `/login?next=/products/projects`。Contact 与 footer 仍多为 `#` / 空串。

### 2.2 L2 认证

| 路由 | 文件 | 状态 | 提交目标 |
| --- | --- | --- | --- |
| `/login` | `src/app/(auth)/login/page.tsx` | `wired` | `POST /api/auth/login` |
| `/signup` | `src/app/(auth)/signup/page.tsx` | `wired` | `POST /api/auth/signup/code` → `POST /api/auth/signup` |
| `/password/reset` | `src/app/(auth)/password/reset/page.tsx` | `wired` | `POST /api/auth/password/code` → `POST /api/auth/password/reset` |

三页共用 `src/app/(auth)/layout.tsx` 的无侧栏认证壳：`lg` 及以上左半屏通栏海报（`public/img/login.webp`）+ 右半屏表单栏，移动端单栏、海报折叠。海报走 `next/image` 且 `sizes="(min-width: 1024px) 50vw, 1px"`，移动端落到最小候选档（实测 12,292 B）。视觉归属见 `docs/designs/Design-system-inventory.md` 的登录页条目。

三页均 `noIndex`。`/password/reset` 只接受「邮箱 + 邮件验证码 + 新口令」三件套，不接受任何形式的重置链接 token —— 验证码通道已经存在，再加一套一次性链接就是第二套真值。

### 2.3 L3 制作应用

侧栏顺序即 Pencil 页面顺序：工作台、项目、画布、镜头、导出；设置固定在底部，不占主导航位。

| 路由 | 文件 | 状态 | 上下文来源 | 缺失上下文时 |
| --- | --- | --- | --- | --- |
| `/products` | `src/app/products/page.tsx` | `redirect` → `/products/dashboard` | 无 | — |
| `/products/dashboard` | `src/app/products/(app)/dashboard/page.tsx` | `wired` | 无 | 空状态引导新建项目 |
| `/products/projects` | `src/app/products/(app)/projects/page.tsx` | `wired` | 无 | 空状态 |
| `/products/canvas/[projectId]` | `src/app/products/(app)/canvas/[projectId]/page.tsx` | `wired` | `projectId` path | 缺失项目 `notFound()`；旧 workflow 显示保留数据说明 |
| `/products/shots/[shotId]` | `src/app/products/(app)/shots/[shotId]/page.tsx` | `wired` | `shotId` path + `projectId` query（必填） | 缺失项目/镜头 `notFound()`；旧 workflow 显示保留数据说明 |
| `/products/export/[projectId]` | `src/app/products/(app)/export/[projectId]/page.tsx` | `wired` | `projectId` path | 缺失项目 `notFound()`；旧 workflow 显示保留数据说明 |
| `/products/settings` | `src/app/products/(app)/settings/page.tsx` | `wired` | `projectId` query（可选） | 无项目参数渲染账号级设置；旧 workflow 显示保留数据说明 |

段级约定（已落盘，新增 L3 路由沿用）：

- `src/app/products/(app)/layout.tsx` 挂 `AppShell`，侧栏跨路由不重挂。
- `src/app/products/(app)/loading.tsx` 提供段级骨架；骨架不得常驻，必须由真实数据替换。
- `src/app/products/(app)/template.tsx` 只做内容区入场动画，不得承载状态。
- 全部 L3 页面 `export const dynamic = 'force-dynamic'`，禁止静态化含项目数据的页面。
- 当前产品 workflow 的唯一母版合同是 `1920×1080 @ 30fps`。项目列表、工作台统计与最近项目只投影当前 `ACTIVE_WORKFLOW_VERSION`；历史 workflow 项目及其 Artifact 不迁移、不删除，但不进入普通列表。
- 项目深链必须用持久化 `workflowVersion` 区分 `supported | legacy | missing`，禁止按创建日期、导出设置或 Artifact 尺寸猜测。`legacy` 显示“旧版项目暂不可用，数据已保留”，`missing` 才调用 `notFound()`。

### 2.4 L4 内部

| 路由 | 文件 | 状态 |
| --- | --- | --- |
| `/playbook` | `src/app/playbook/page.tsx` | `wired` |
| `/playbook/ui` | `src/app/playbook/ui/page.tsx` | `wired`（41 组件族，与 `UI_COMPONENT_FAMILY_COUNT` 同步） |
| `/playbook/icons` | `src/app/playbook/icons/page.tsx` | `wired`（Pencil A4 图标白名单） |
| `/playbook/foundations` | `src/app/playbook/foundations/page.tsx` | `wired`，但无 registry 分类 |

`/playbook/foundations` 是手写 token 展示页，`PlaybookCategory` 只有 `ui | icons`。这是已知不一致：foundations 要么补进 registry，要么在索引页标注它不是组件登记页。

`/playbook/patterns` 与 `patterns` 分类已于 2026-07-25（ISSUE-007）整体删除：唯一登记项 `WorkflowCanvas` 是脚手架期硬编码 fixture（`STAGE_B_WORKFLOW_NODES`），未被 `docs/designs/Design-system-inventory.md` 登记为必需组合，且其内联的两个 disabled 按钮与「`ProductFlowVersion`/`FlowNode`」文案引用了 §12 已作废的 Release 六步模型实体。删除后不留空分类占位，见 §2.5。

### 2.5 已收敛

以下路由与并行壳已于 2026-07-25 删除，不允许回归。`tests/app-route-contract.test.tsx` 锁定这一点。

| 已删 | 替代 |
| --- | --- |
| `/legacy/*` | `/products/*` |
| 根 `/dashboard` | `/products/dashboard` |
| `/products/[productId]` | 无（未接线空壳） |
| `/releases`、`/releases/[releaseId]/{brief,flow,evidence,storyboard,review,artifacts,sources,render}` | `/release` 单页占位 |
| `(product)` 路由组整体（含 `ProductAppShell`、`ProductSidebar`、`ReleaseStepNav`、`ProductPageHeader`） | `(auth)` + `(public)` + `products/(app)` |
| `/playbook/patterns`（含 `patterns` 分类、`src/features/workflow/**`） | 无（ISSUE-007：分类整体移除，无设计真值要求保留） |

`/releases/[releaseId]/artifacts` 与 L1 的 `/artifacts` 曾有语义冲突，这批删除同时解决了它。

## 3. 元数据路由

| 路由 | 文件 | 状态 | 规则 |
| --- | --- | --- | --- |
| `/robots.txt` | `src/app/robots.ts` | `wired` | 当前 `allow: /`、`disallow: /api/`、`/private/`。新增 `/share/` 到 disallow |
| `/sitemap.xml` | `src/app/sitemap.ts` | `wired` | 当前只有 `/` 一条。`/artifacts` 与每个 `featured` 案例必须进 sitemap |
| `/favicon.ico`、`/icon.svg`、`/apple-icon.svg` | `src/app/*` | `wired` | — |
| `/site.webmanifest` | `public/site.webmanifest` | `wired` | 由 `src/lib/metadata.ts` 的 `manifest` 引用 |

## 3.1 错误与未找到边界

| 文件 | 承载 | 壳 | 状态 |
| --- | --- | --- | --- |
| `src/app/not-found.tsx` | URL 未匹配；无更近边界的 `notFound()` | `ds-app-gradient` 全屏，无侧栏 | `wired` |
| `src/app/products/(app)/not-found.tsx` | L3 各页显式 `notFound()` | `AppShell` 内，侧栏保留 | `wired` |
| `src/app/products/(app)/error.tsx` | L3 未处理异常（Client，带 `reset`） | `AppShell` 内，侧栏保留 | `wired` |
| `src/app/global-error.tsx` | root layout 失效后的兜底（自带 `html`/`body`） | 自带样式，无 Providers | `wired` |

规则：

1. **不回显原始错误。** 只展示错误类别文案与 `error.digest` 指纹。message、堆栈、provider 原始响应可能携带凭据或内部标识，一律不渲染；完整错误留在服务端日志，按 digest 对账。
2. **404 文案不区分「不存在」与「无权访问」**，与 §9.2 的 404 语义一致。
3. **段级边界优先。** L3 的 404 与错误必须落在 `(app)` 段内，让用户留在应用壳里，不被踢回公开层。
4. **视觉复用已登记组件。** 四个页面共用 `src/app/_components/route-status.tsx`（C 层组合），内部只组合已登记的 `EmptyState` 与 `Button`，不新增空状态或卡片视觉。图标取自 design-system-inventory §9 白名单：未找到用 `info`，失败用 `circle-x`，重试用 `refresh-cw`，返回用 `arrow-left`。
5. **状态不靠色相。** 状态语义由图标加标题文本共同表达；失败态挂 `role="alert"`。
6. 不渲染假数据、假进度或常驻骨架。
7. `global-error.tsx` 里主题初始化脚本不会执行，按 `:root` 默认的 Porcelain Light 渲染，这是已接受的降级。

## 4. API 路由表

`src/app/api/**` 只做参数解析、鉴权与响应映射；SQL、渲染参数、状态机留在 `src/features/*`。

### 4.1 Next 自有 API

| 路由 | 方法 | 上下文参数 | 委托 | 状态 |
| --- | --- | --- | --- | --- |
| `/api/ping` | GET | — | 无 | `wired` |
| `/api/projects` | GET, POST | — | `@/features/canvas` | `wired` |
| `/api/projects/[id]` | PATCH | `id` path | `@/features/canvas` `updateExportSettings` | `wired` |
| `/api/artifacts/[id]` | GET | `id` path + `projectId` query（必填） | `@/features/artifacts` | `wired` |
| `/api/jobs/[id]` | GET | `id` path + `projectId` query | `@/lib/queue`、`@/features/artifacts` | `wired` |
| `/api/render` | POST | body `{projectId,nodeId}` | `@/features/render/queue-handler` | `wired` |
| `/api/render/export` | GET, POST | `projectId` | `@/features/render/export-service` | `wired` |
| `/api/render/thumbnails` | GET | `projectId`、`nodeId` | `@/features/render` | `wired` |
| `/api/director/pipeline` | POST, DELETE | body `{projectId}` | `@/features/director/advance` | `wired` |
| `/api/director/stage` | POST | body `{projectId,nodeId,stage}` | `@/features/director/queue-handler` | `wired` |
| `/api/director/stream/[nodeId]` | GET (SSE) | `nodeId` path + `projectId` query | `@/lib/stream/stream-bus` | `wired` |
| `/api/director/stream/project/[projectId]` | GET (SSE) | `projectId` path | `@/lib/stream/status-bus` | `wired` |
| `/api/share/[shareId]` | GET | `shareId` path | `@/features/share`（待建） | `planned` |
| `/api/settings` | GET, POST | — | `@/features/ai/*`、`@/lib/queue/runtime-config` | `wired` |

约定：

1. 写操作一律 POST/PATCH/DELETE + 严格 JSON schema 校验；校验失败返回 400 且**不落任何写入**。
   `/api/settings` POST 承载字段范围：StepFun/Gemini 凭据与模型、Director 节点路由、`laneQuotas.{directorStageConcurrency, renderShotConcurrency}`（ISSUE-011）。
   `laneQuotas` 子字段做两层校验：schema 静态 max（directorStage≤32、renderShot≤128）+ route 运行时 `os.cpus().length` 上限；任一失败回 400 且不落任何 secret / route / 配额写入。
2. 状态码语义固定：400 参数非法、404 资源不存在或不属于当前作用域、409 状态冲突（队列已存在、前置未就绪、旧 workflow 暂不支持执行）、422 外部凭据校验失败。项目设置、Director、单镜渲染、缩略图与成片导出的写/执行入口必须在任何数据库、Artifact 或队列变更前拒绝旧 workflow。
3. 凭据类 POST 必须先验证后保存；验证失败返回 422 且不覆盖已有值。
4. 除 `/api/ping` 外全部 `export const dynamic = 'force-dynamic'`。

### 4.2 引擎代理

`next.config.ts` 唯一 rewrite：`/api/engine/:path*` → `${BACKEND_ORIGIN || http://localhost:8787}/:path*`。

| 前端路由 | worker 端点 |
| --- | --- |
| `GET /api/engine/health` | `GET /health` |
| `POST /api/engine/render` | `POST /render` → 202 `{jobId, statusUrl}` |
| `GET /api/engine/jobs` | `GET /jobs` |
| `GET /api/engine/jobs/:id` | `GET /jobs/:id` |
| `GET /api/engine/jobs/:id/video` | `GET /jobs/:id/video`（支持 Range，206/409/416） |

规则：

- 浏览器只打同源 `/api/engine/*`；客户端 base 固定由 `src/lib/api.ts` 的 `API_BASE` 提供，页面与组件不得直连 worker 端口。
- worker 不对外暴露，生产走内网 `BACKEND_ORIGIN`。worker 当前 `Access-Control-Allow-Origin: *` 且无认证，因此暴露到公网即为未授权渲染入口。
- `statusUrl` 是 worker 相对路径（`/jobs/<id>`），前端消费时必须补 `API_BASE` 前缀，不得直接当作 Next 路由使用。

### 4.3 资源 URL 合同

| 资源 | URL 形状 | 生产方 | 消费方 |
| --- | --- | --- | --- |
| Artifact 下载 | `/api/artifacts/{artifactId}?projectId={projectId}` | `api/jobs/[id]`、`api/render/export`、`api/render/thumbnails`、`shots/[shotId]/page.tsx` | `ArtifactChip`、`ExportWorkspace`、`CanvasInspector` |
| 阶段日志流 | `/api/director/stream/{nodeId}?projectId={projectId}` | `use-stage-stream.ts` | `StreamingLogCard` |
| 项目状态流 | `/api/director/stream/project/{projectId}` | `use-project-status-stream.ts` | `CanvasView`（节点状态覆盖层 + 拓扑变更触发 refresh） |
| worker 视频 | `${API_BASE}/jobs/{jobId}/video` | `src/lib/api.ts` | 下载/播放 |

四条 URL 的所有 path 与 query 片段都必须 `encodeURIComponent`。ISSUE-009 已修复 `canvas-inspector.tsx` 与 `src/lib/api.ts` 的编码缺失。

项目状态流与阶段日志流职责不同（状态事件 vs 文本增量），两者并存；静态段 `project`
优先于动态段 `[nodeId]` 匹配，nodeId 为 UUID 不会与字面量 `project` 冲突（ISSUE-012）。

没有真实 Artifact 时不允许渲染播放器、下载按钮或可点击的产物 chip。

## 5. URL 与上下文规则

1. **`projectId` 是制作侧唯一主上下文。** 需要项目上下文的页面必须从 URL 取得，不得从客户端全局状态、`localStorage` 或最近访问记录隐式推断。
2. **上下文位置固定。** 能唯一定位资源的 id 走 path segment（`canvas`、`export`、`shots`、`artifacts`、`share`）；用于消歧或收窄视图的 id 走 query（`shots` 的 `projectId`、`settings` 的 `projectId`、全部 `/api/*` 的 `projectId`）。同一个 id 不允许在两种位置之间随页面漂移。
3. **URL 集中生成。** L3 的所有链接由 `src/features/navigation/products-routes.ts` 生成，页面与组件禁止手写 `/products/...` 模板字符串。新增 L3 路由必须同时补 helper、补 `resolveProductsSection`、补 `products-routes.test.ts`。
4. **Next 16 异步入参。** `params`、`searchParams`、`cookies`、`headers` 必须 `await`。
5. **编码。** 任何 id 进 URL 前 `encodeURIComponent`；测试需覆盖含 `/` 的 id（现有测试用 `%2F` 断言，保留）。
6. **`/products/settings` 承担两类设置**，页面内必须分区并各自标注生效范围：带 `projectId` 时是项目级导出与渲染设置；不带时是账号级凭据与模型路由设置。凭据只写加密内容，master key 只从 server-only 环境读取。
7. **禁止可点击但无行为的导航项。** 缺少必要上下文时侧栏项渲染禁用态并给出 `disabledReason`。现行文案：画布/导出为「请先选择一个项目」，镜头为「当前项目还没有可渲染镜头」。

## 6. 导航真值

| 关注点 | 唯一实现 |
| --- | --- |
| 常驻壳 | `src/features/navigation/app-shell.tsx` |
| 响应式与抽屉 | `src/features/navigation/app-sidebar-shell.tsx`（`expanded` / `rail` / `hidden`，优先级 hidden > rail > expanded） |
| 侧栏内容 | `src/features/navigation/app-sidebar.tsx` |
| pathname → 高亮 | `resolveProductsSection`（`src/features/navigation/products-routes.ts`） |
| 深链上下文传递 | `src/features/navigation/nav-context.tsx` |

`resolveProductsSection` 的匹配顺序有语义：子路由（`shots/`、`export/`、`canvas/`）必须先于根前缀匹配，否则高亮错位。新增路由插入时保持这个顺序不变。

侧栏获取 `projectId` 的优先级是 `searchParams.get('projectId')` → `NavContext` → `undefined`。服务端页面通过 `<PublishNavContext projectId rendererNodeId />` 把**服务端已校验过的** id 交给常驻侧栏；客户端组件不得自行编造这两个值。

`AppSection` 的枚举名与 URL 段名不一致，属已固化词汇，不再改动：

| `AppSection` | URL 段 | 中文标签 | Pencil 屏 |
| --- | --- | --- | --- |
| `workbench` | `dashboard` | 工作台 | S1 / S2 |
| `projects` | `projects` | 项目 | — |
| `canvas` | `canvas` | 画布 | S3 |
| `renderer` | `shots` | 镜头 | S4 |
| `export` | `export` | 导出 | S5 |
| `settings` | `settings` | 设置 | S6 |

## 7. 设计稿路由名与实现路由名

`Design-system-inventory.md` 的 S1–S6 用的是无前缀路由名。实现加了 `/products` 前缀。映射固定如下，两侧都不再改名：

| Pencil 屏 | 设计稿路由 | 实现路由 |
| --- | --- | --- |
| S1 | `/workbench` | `/products/dashboard` |
| S2 | `/workbench` New Project 态 | `/products/dashboard` 上的模态，不是独立路由 |
| S3 | `/canvas/[projectId]` | `/products/canvas/[projectId]` |
| S4 | `/shots/[shotId]` | `/products/shots/[shotId]?projectId=` |
| S5 | `/export/[projectId]` | `/products/export/[projectId]` |
| S6 | `/settings` | `/products/settings?projectId=` |

S2 是 S1 的模态状态，**不允许**为它开一条路由。任何「新建 / 编辑 / 确认」类模态默认不进 URL；只有需要分享或刷新保持的模态才允许升级为路由，并须在本文件登记。

## 8. `/artifacts` 与 `/share`

### 8.1 一个实体，两个投影面

案例展示与工作流分享不是两套数据，而是同一个不可变实体的两种可见性。

```text
Project（可变，L3 内部）
  └─ ShareSnapshot（不可变、版本化、独立不可枚举 shareId）
       ├─ visibility = private   ->  不可访问
       ├─ visibility = link      ->  /share/[shareId]，noindex
       └─ visibility = featured  ->  /share/[shareId] + /artifacts + /artifacts/[caseSlug]
```

`ShareSnapshot` 是分享与案例的唯一数据源。`/artifacts` 只是它 `visibility = featured` 的读投影，不新增第二套内容模型、第二套 ID 体系或人工维护的案例文案表。

### 8.2 为什么不能直接分享 `projectId`

- `projectId` 是 workspace 内部主键，公开会泄露内部标识且可被枚举。
- 项目可变。直接分享活项目意味着访问者看到的内容随作者继续编辑而变化，与「approved/released 不可原地更新」冲突。
- 关闭分享时无法在不影响制作侧的前提下换掉标识。

因此 `shareId` 必须是与 `projectId` 无推导关系的随机 token，且一个 Project 可以有多条 `ShareSnapshot`。

### 8.3 快照内容

快照是清单，不是文件副本。存储层不复制字节，只按 `content_hash` 引用既有 Artifact。

允许进入快照：

- 项目标题、简介、创建时间；
- 画布图的固定版本（节点、连线、节点类型），仅公开字段；
- 镜头列表与各镜头公开元数据；
- 导出设置白名单子集（画幅、分辨率、时长、帧率）；
- 引用的成片 Artifact：`artifactId` + `contentHash` + `sizeBytes`，`lifecycle` 必须是 `approved` 或 `released`；
- 作者展示名与水印开关。

必须排除：凭据与 API key、模型与路由配置、原始 prompt 与内部脚本全文、任何 `draft` Artifact、`workspaceId` 与其他内部主键、`taskAttempts` / `pipelineRuns` 内部 id。

实现方式是服务端白名单序列化，**不是**「取整个项目对象再删几个字段」。否则以后加字段就会静默泄露。

### 8.4 行为矩阵

| 动作 | 结果 |
| --- | --- |
| 开启分享 | 新建 `ShareSnapshot`，`visibility = link`，分配 `shareId` |
| 作者继续编辑项目 | 已有快照不变；L3 显示「当前项目已领先于分享版本」 |
| 更新分享 | 新建下一版本快照并记录 `supersedes`；旧 `shareId` 默认失效 |
| 关闭分享 | `visibility = private`；`/share/[shareId]` 返回 404，不返回 403 |
| 运营精选 | `visibility = featured` + 分配 `caseSlug`，进入 `/artifacts` 与 sitemap |
| 引用的 Artifact 被新版本取代 | 快照仍指向原 `contentHash`，不跟随；页面标注版本时间 |

### 8.5 页面规则

- `/share/[shareId]`：只读。无侧栏、无写操作、不暴露原始工程。必须 `noindex, nofollow`，并加入 `robots.ts` 的 disallow。
- `/artifacts`：可索引。列表项只显示快照公开字段与成片封面。禁止假播放量、假评分、固定假百分比。
- `/artifacts/[caseSlug]`：可索引。`caseSlug` 由运营指定且唯一；变更 slug 必须为旧 slug 保留 308。
- 三类页面的播放与下载都必须指向真实存在的 Artifact；无 Artifact 时不渲染播放器或下载按钮。

### 8.6 API 边界

`/api/share/[shareId]` 只接受 `shareId` 或 `caseSlug`，不接受 `projectId` 或 `workspaceId`，且不复用带 workspace 上下文的 repository 查询。公开读路径与制作侧查询路径分离，避免一次 join 就把内部字段带出去。

公开页引用成片时不得直接复用 `/api/artifacts/{id}?projectId=` —— 那条 URL 携带内部 `projectId`。公开侧需要独立的 `/api/share/[shareId]/video` 之类端点，由 `shareId` 反解 Artifact。

## 9. 守卫、认证与错误语义

### 9.1 当前实现缺口

必须先记清事实：**目前仓库没有任何认证。** `src/` 下既无 `proxy.ts` 也无 `middleware.ts`，全部页面与全部 `/api/*` 都不读 cookie/session，workspace 固定为 `LOCAL_WORKSPACE_ID`。因此：

- `/products/*` 与全部 `/api/*` 在当前状态下是**未授权可访问**的。
- 所有 API 的作用域只有「调用方自己传的 `projectId`」，没有归属校验。
- 本节的守卫是目标状态，不是已实现状态。在认证落地前，本应用只能跑在本地或受信网络内，不得直接暴露公网。

**入站边界现由部署层保证（ISSUE-015 P-2，`docs/deployment/access.md`）**：生产环境反代（Caddy）在网络层 IP 过滤 + Basic Auth over TLS 两道防线拒绝未授权入站请求，`next` 容器本身不 publish 任何端口。但这只是把「公网任意人」收敛成「受信网络内 + 拿到共享口令的任意人」——**不等于应用内认证已实现**：拿到凭据的任何人仍是全权管理员（无租户、无角色、无审计），产物 URL 仍携带内部 `projectId`，`LOCAL_WORKSPACE_ID` 仍是硬编码单工作区。应用内认证是独立议题，见 `PLAN-002-auth-system.md`。

### 9.2 目标守卫矩阵

| 情况 | 响应 |
| --- | --- |
| 未登录访问 `/products/*` | 302 → `/login`，带回跳目标 |
| 已登录访问 `/login`、`/signup` | 302 → `/products/dashboard` |
| `projectId` 不存在或不属于当前 workspace | 404 |
| `shotId` 不属于该 `projectId`，或节点类型不是 `shot-codegen` | 404 |
| `shareId` 不存在、已撤销、已被新版本取代 | 404 |
| `caseSlug` 不存在 | 404 |
| 上下文缺失但路由本身合法 | 不进入页面；侧栏项禁用并给出原因 |
| 非生产环境外访问 `/playbook/*` | 404 |

一律用 404 掩盖归属错误，不区分「不存在」与「无权限」，避免泄露其他 workspace 中对象是否存在。前端不得为了让页面渲染成功而隐式创建缺失数据。

### 9.3 认证落地的最小要求

认证接入时必须一次覆盖三处，不允许只做页面跳转：

1. `proxy.ts`（Next 16 取代 `middleware.ts`）或等价 layout 守卫：拦 `/products/*`。
2. 每个 `/api/*` handler：从 session 解析 `workspaceId`，替换 `LOCAL_WORKSPACE_ID`，且 `projectId` 必须与该 workspace 联合校验。
3. worker：`/api/engine/*` 之后的调用需要服务间凭据，worker 不再对任意来源开放。

## 10. `/release` 占位

`/release` 为未来「发布新产品制作」保留，当前只允许单页占位，必须显式说明尚未接线与未来数据来源。

禁止提前落 `/release/[releaseId]/*` 子路由、多步导航、禁用按钮矩阵或任何空统计面板。占位页的成本必须接近零，否则它会再一次变成需要维护的第二套壳。

## 11. 收敛清单

删除前必须先验证等价功能已在新 URL 可用。

| 资产 | 处置 | 理由 | 状态 |
| --- | --- | --- | --- |
| `src/app/products/(app)/canvas/[projectId]/canvas-inspector.tsx` | 修 artifact href 的 `projectId` 编码 | §4.3 | ✅ 已完成（ISSUE-009） |
| `src/app/robots.ts` | 增加 `/share/` 到 disallow | §8.5 | ✅ 已完成（ISSUE-009） |
| `src/app/sitemap.ts` | 增加 `/artifacts` 与 featured 案例 | §3 | ⏳ 结构就绪，待 `ShareSnapshot` 落盘后接入（见 `sitemap.ts` 注释） |
| `src/components/ui/empty-state.tsx` | token 收敛：仍在用 `text-label-secondary` / `text-label-tertiary` 等历史 token | design-system-inventory §4 要求新 Canonical 组件只用 `ds-*` | ✅ 已完成（ISSUE-009） |
| `font-sc` class | 全仓库未定义，`button.tsx`、`empty-state.tsx` 仍在挂 | 空类名，应删或补定义 | ✅ 已删除（ISSUE-009） |

错误与未找到边界（`not-found.tsx` ×2、`error.tsx`、`global-error.tsx`、`route-status.tsx`）已落盘，见 §3.1。

已完成、无需再处理（见 §2.5）：`/legacy/*`、根 `/dashboard`、`/products/[productId]`、整个 `(product)` 路由组、`/playbook/patterns`（含 `WorkflowCanvas`，ISSUE-007）。占位组件已收敛到 `src/app/_components/{unwired-panel,route-shell-page}.tsx`。`src/app/README.md` 记录路由树现状。

## 12. 归档：已作废的 Release 六步规范

2026-07-25 之前的规范把 `/releases/:releaseId/{brief,flow,evidence,storyboard,review,artifacts}` 当作核心制作路径，并定义了 `ReleaseBriefVersion → ProductFlowVersion → CaptureRun → NodeEvidence → StoryboardVersion → Preview` 的前置守卫链。

作废原因：这些实体在 `src/lib/db/schema/*` 中全部不存在（实存为 `workspaces / projects / canvas / execution / artifacts`），且六步路径与已经可工作的画布、镜头、导出链路互不衔接。

被继承的部分：「版本不可变、下游固定引用某个已批准版本、失败保留阶段而不回到起点」这三条思路，已由 §8 的 `ShareSnapshot` 和现有 Artifact lineage 承接。

未来若恢复发布流程，从 `/release` 重新立规范，不复用旧 URL。

## 13. 命名遗留

三处命名与领域术语重叠，属已知代价，不再改动，但新增路由不得继续加重：

| 名字 | 在路由里的意思 | 容易混淆的对象 |
| --- | --- | --- |
| `/products/*` | 制作应用本体 | 被营销的 Product 实体 |
| `/artifacts` | 对外案例库 | `artifacts` 表（渲染产物记录） |
| `/release` | 未来发布流程入口 | 已作废的 Release 六步模型 |

案例库页面引用产物时必须写明它读的是 `Artifact` 记录，避免第二列的混淆继续扩散。

## 14. 新增路由检查表

新增任何路由前逐条过：

1. 属于 §1 四层中的哪一层？壳、认证、可索引性是否与该层一致？
2. 已在 §2 或 §4 的表里登记？状态标了 `wired` / `shell` / `planned` / `redirect`？
3. 上下文 id 的位置符合 §5 第 2 条（path 还是 query）？
4. L3 路由是否补了 `products-routes.ts` helper、`resolveProductsSection` 分支和对应测试？
5. 是否需要新的守卫？404 / 302 / 409 行为在 §9 有对应？
6. 是否是模态而非路由（§7 最后一段）？
7. 可索引路由是否进了 `sitemap.ts`；不可索引路由是否进了 `robots.ts` disallow？
8. 页面可见字段是否都能追溯到 API、数据库投影、Artifact 或明确的未接线占位？

## 15. 待锁定决策

| 编号 | 问题 | 建议 |
| --- | --- | --- |
| D1 | `shots` / `settings` 的项目上下文用 query 还是嵌到 `/products/projects/[projectId]/*` | 保留扁平形态匹配 Pencil；用统一的 `resolveProjectContext` 收敛守卫，避免每页重复校验。改动窗口在认证落地前最便宜 |
| D2 | 认证接入的时间点 | 建议排在 `/share` 之前。`/share` 会引入第一个真正的公开读路径，此时如果 L3 仍无认证，公私边界无法验证 |
| D3 | `/artifacts` 是否需要分类、标签或搜索 | 首版只做时间序列表；等真实案例数量再定 |
| D4 | 分享是否需要有效期与访问口令 | 首版只做 `private` / `link` / `featured` 三态 |
| D5 | `/playbook/*` 在生产环境的可见性 | 建议非生产才注册路由，避免内部组件表面对外可达 |
| D6 | 营销首页与 `/artifacts` 的互相入口位置 | 等 Pencil 补画，不在页面里临时加导航 |
