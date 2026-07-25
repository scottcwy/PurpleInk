# ISSUE-010 超限文件职责拆分设计

## 1. 目标

在不改变页面行为、视觉、API 调用、路由或 Server/Client Component 语义的前提下，
按真实职责拆分以下两个超出生产文件硬上限的客户端组件：

- `src/app/products/(app)/shots/[shotId]/shot-detail.tsx`
- `src/app/products/(app)/export/[projectId]/export-workspace.tsx`

完成后：

- 两个入口文件以页面编排为唯一职责，目标不超过 250 行；
- 每个新增生产文件不超过 250 行；
- `pnpm verify:v3` 不再报告这两个路径；
- architecture baseline 不登记当前路径为新债务；
- 拆分前后两个页面的真实 Chromium 视觉和控制台行为等价。

## 2. 非目标

本任务不：

- 修复 Director、渲染、导出、轮询或媒体播放中的功能问题；
- 修改 `/api/*` 请求、响应或错误文案；
- 修改任何页面文案、CSS class、DOM 顺序或可交互行为；
- 修改 `server/**`；
- 引入新依赖、公共 wrapper、第二套状态模型或纯 re-export 文件；
- 处理 ISSUE-007 或工作树中其他已有改动。

## 3. 根因

### 3.1 分镜详情

`shot-detail.tsx` 同时承担：

1. 页面与 TopBar 编排；
2. 分镜代码读取和渲染状态；
3. 视频播放与逐帧控制；
4. 缩略图异步加载与轨道展示；
5. 代码面板展示；
6. 分镜合同展示。

这些职责具有不同变化原因。播放器会因媒体交互变化，运行时 hook 会因 API
工作流变化，代码与合同面板会因展示需求变化，均不应留在页面编排文件。

### 3.2 导出工作区

`export-workspace.tsx` 同时承担：

1. 页面编排；
2. readiness、导出和分辨率更新状态；
3. 成片预览；
4. 时间线投影；
5. 响应式设置面板和抽屉；
6. QA 状态展示。

状态生命周期、时间线视图模型和响应式评审区域是三个独立变化原因。

### 3.3 architecture baseline

baseline 仍记录路由迁移前的两条 `src/app/legacy/**` 超限路径。当前生产路径不在
baseline 中，所以门禁把它们报告为 `OVERSIZED_NEW_FILE`。拆分完成后应删除对应的
失效 legacy 记录，不得把当前路径加入 baseline。

## 4. 模块设计

### 4.1 分镜详情模块

#### `shot-detail.tsx`

唯一职责：组合页面 TopBar、播放器、代码面板和合同面板。

保留：

- `ShotDetail`；
- 上一镜、下一镜链接；
- 导出和重渲操作的页面级接线；
- `usePublishNavContext`。

#### `use-shot-runtime.ts`

唯一职责：管理一个分镜详情页的客户端异步运行状态。

包含：

- `NO_CODE` 空代码真值；
- `previewUrl` HTML 读取；
- `renderShotAndWait` 调用；
- `outputUrl`、加载、失败和渲染状态；
- 成功后的 `router.refresh()`。

它继续复用 `shot-api.ts`，不复制请求实现。

#### `shot-player.tsx`

唯一职责：展示和控制真实分镜媒体。

包含：

- 视频、iframe 和空态三种既有分支；
- 播放、暂停、逐帧前后移动；
- 时间码与播放进度；
- 缩略图加载和轨道展示；
- 播放器区域错误 Toast。

#### `shot-detail-panels.tsx`

唯一职责：展示分镜代码与合同内容。

包含：

- `ShotCode`；
- 代码同步状态映射；
- `ShotContract`。

现有 `shot-panels.tsx` 继续只负责可折叠、可调整宽度的面板容器，不接收这些展示
内容，避免其逼近新的硬上限。

### 4.2 导出工作区模块

#### `export-workspace.tsx`

唯一职责：组合 TopBar、成片预览、时间线和导出评审区域。

保留：

- `ExportWorkspace`；
- `ExportPreview`；
- `ExportTimeline`；
- `usePublishNavContext`。

#### `use-export-runtime.ts`

唯一职责：管理导出页面的客户端异步状态。

包含：

- 初次加载 `ExportReadiness`；
- 发起导出并写入 `outputUrl`；
- 分辨率乐观更新；
- PATCH 失败后的真实状态回拉；
- 既有错误归一化文案。

它继续复用 `export-api.ts`，不复制 API 请求。

#### `export-review.tsx`

唯一职责：展示和控制导出设置与 Final QA 区域。

包含：

- 响应式折叠状态和 Drawer；
- 可调整宽度设置面板；
- `ExportSettings`；
- `ExportQa`。

#### `export-view-model.ts`

继续作为无副作用视图模型：

- 保留时间线片段投影；
- 新增分辨率预设到 SegmentedControl 选项的映射；
- 不引入 React、hook 或 API 依赖。

## 5. 数据流与边界

分镜页数据流保持：

```text
Server page props
  -> ShotDetail
  -> useShotRuntime
  -> shot-api
  -> ShotPlayer / ShotCode / ShotContract
```

导出页数据流保持：

```text
Server page props
  -> ExportWorkspace
  -> useExportRuntime
  -> export-api
  -> ExportPreview / ExportTimeline / ExportReview
```

依赖只从页面编排指向 hook、展示组件和既有 API 模块。新模块之间不反向 import
入口文件，不引入循环依赖。

## 6. 行为等价策略

拆分时原样迁移：

- 所有中文文案；
- JSX 分支和元素顺序；
- Tailwind class；
- localStorage key；
- breakpoint、宽度和 motion token；
- effect 依赖；
- loading、error、disabled 与乐观更新时序；
- `router.refresh()` 调用条件；
- API 参数和回退错误。

结构修复不借机调整现有可疑行为。发现功能问题时只登记，不在 ISSUE-010 内修复。

## 7. 测试与验收

### 自动验证

1. 为 `export-view-model.ts` 新增的分辨率选项映射先写失败测试；
2. 运行相关定向测试确认 RED，再实现最小映射并确认 GREEN；
3. 运行：
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm verify:v3`
   - `pnpm build`
   - `git diff --check`
4. 扫描 `AGENTS.md README.md docs src server scripts` 中的 U+FFFD。

### 结构验收

- 两个入口文件均不超过 250 行；
- 每个新增生产文件均不超过 250 行；
- baseline 删除两条失效 legacy 记录，不新增当前路径；
- `debtCaps.directOpenAiClientImports` 保持 3；
- 自查新模块 import 图没有循环。

### 浏览器验收

对以下页面在拆分前后使用同一数据、视口和浏览器状态截图：

- `/products/shots/[shotId]?projectId=...`
- `/products/export/[projectId]`

证据保存到 `docs/issues/evidence/issue-010/`，并记录：

- 截图；
- 页面 URL 与视口；
- 控制台 error；
- 拆分前后视觉比较结论。

若本地缺少可访问项目或数据库，必须记录阻塞原因，不能用假数据替代真实页面证据。

## 8. 提交边界

实现按两个可独立验证的职责阶段提交：

1. 分镜详情拆分；
2. 导出工作区拆分、baseline/AGENTS 清理及最终证据。

每次只 stage ISSUE-010 文件，提交前检查 staged 文件列表，不夹带 ISSUE-007
或其他已有工作树改动。
