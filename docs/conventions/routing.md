1. 用户路径
PurpleInk 是一套持续制作产品发布视频的工作流。
用户先登记一个长期存在的 Product，
再为某次功能上线创建一条 Release，
最后把经过批准的发布信息和真实产品证据制作成视频 Artifact。
三个核心对象的区别如下：
暂时无法在飞书文档外展示此内容
整条用户路径可以概括为：
注册或登录
  -> 建立 Product
  -> 创建 Release
  -> Brief
  -> Flow
  -> Evidence
  -> Storyboard
  -> Review
  -> Artifacts
路由中的 :releaseId 是动态参数，
表示当前操作的是哪一条 Release。例如：
/releases/7b6a2f/brief
表示打开 ID 为 7b6a2f 的 Release Brief 页面。
2. 路由总览
暂时无法在飞书文档外展示此内容
当前 Release 的正式六步导航为：
Brief -> Flow -> Evidence -> Storyboard -> Review -> Artifacts
3. 账号与 Workspace 路由
3.1 /login

页面目标
让已有用户完成身份认证，并进入自己有权限访问的 Workspace。
页面主要内容
- 工作邮箱输入框。
- 密码输入框。
- 登录按钮。
- 前往 /signup 的注册链接。
- 登录失败、账号锁定或网络异常提示。

核心操作
用户提交邮箱和密码。认证成功后，系统通常将用户带到 /dashboard；如果用户之前访问了一个受保护页面，也可以在权限允许时返回原页面。
页面边界
- 本页只处理登录，不负责创建 Product 或 Release。
- 已登录用户再次访问时，应直接进入应用或显示当前会话状态。
- 错误信息不能泄露某个邮箱是否已经注册。

3.2 /signup

页面目标
创建用户账号以及用户首次使用所需的 Workspace。
Workspace 是团队数据的权限边界。Product、Release、审批和 Artifact 都属于某个 Workspace。
页面主要内容
- 用户姓名。
- 工作邮箱。
- Workspace 名称。
- 密码。
- 创建 Workspace 按钮。
- 前往 /login 的入口。

核心操作
用户提交注册信息后，系统创建 User、Workspace 和成员关系。注册完成后进入 /dashboard，随后引导用户创建第一个 Product。
页面边界
- 注册成功不应该自动虚构示例 Product 或 Release。
- Workspace 名称可在后续设置中修改，不应作为不可变 ID 使用。
- 密码策略、重复邮箱和服务端校验必须有明确反馈。

4. 控制台入口路由
4.1 /dashboard

页面目标
作为 Workspace 的工作控制台，让用户快速判断当前有哪些事情需要处理。
它回答四个问题：
1. 最近有哪些 Product 和 Release？
2. 哪些 Release 正在运行？
3. 哪些内容等待审批？
4. 哪些后台任务失败或被阻塞？

页面主要内容
- 最近访问或更新的 Product。
- 活跃 Release 及其当前阶段。
- 待批准的 Brief、Evidence、Storyboard 或 Preview。
- 失败的采集或渲染任务。
- 新建 Release 和添加 Product 的快捷入口。

核心操作
Dashboard 以导航和汇总为主。用户点击某个项目后，应进入对应的 Product 页面或 Release 当前阶段，而不是在 Dashboard 内完成复杂编辑。
空状态
当 Workspace 还没有 Product 时，页面应引导用户先进入 /products 添加产品。没有 Product 就不能创建有效的 Release。
4.2 /products

页面目标
管理 Workspace 中长期存在的软件产品，并提供创建 Product 的入口。
Product 是可以被多次 Release 复用的资产容器。它不是一次视频任务。
页面主要内容
- Product 名称和状态。
- 产品 URL。
- 最近一次 Release 或最近更新时间。
- BrandKit 完整度。
- 可复用 ProductFlow 数量。
- 添加、搜索、筛选和归档 Product 的入口。

核心操作
- 添加 Product。
- 打开 Product 详情。
- 查看或维护 BrandKit、ProductCapability 和 ProductFlow。
- 对不再使用的 Product 执行归档，而不是直接删除历史数据。

与 Release 的关系
一个 Product 可以拥有多个 Release。Product 保存可复用资产，Release 只固定引用某个已批准版本，避免后来修改 Product 资产时破坏历史发布。
4.3 /releases

页面目标
展示当前 Workspace 下跨 Product 的所有 Release，并提供新建 Release 的入口。
页面主要内容
- Release 名称。
- 所属 Product。
- 生命周期状态，如 active、failed、cancelled、delivered。
- 当前制作阶段，如 Brief、Evidence、Review 或 Final Rendering。
- 最近更新时间、负责人和待审批状态。
- 搜索、Product 筛选、状态筛选和分页。

核心操作
- 选择一个 Product 并创建 Release。
- 打开已有 Release。
- 进入 Release 当前应处理的步骤。
- 查看失败原因，重试允许重试的任务。
- 取消仍处于活动状态的 Release。

与 Dashboard 的区别
Dashboard 是“需要关注什么”的摘要；/releases 是完整的 Release 数据列表和管理入口。
5. Release 制作流程路由

5.1 /releases/:releaseId/brief

页面目标
定义这次发布视频要对谁说、说什么、用什么事实证明，以及最终希望观众采取什么行动。
ReleaseBrief 是结构化制作需求，不是一个任意 Prompt。
页面主要内容
- 目标受众。
- 发布目标。
- 核心卖点和 ProductCapability。
- 允许使用的事实主张。
- 发布渠道和目标画幅。
- 目标时长。
- CTA。
- Brief 版本、草稿状态和审批状态。

核心操作
- 保存草稿。
- 编辑受众、卖点、渠道和 CTA。
- 提交审批。
- 批准或驳回当前 Brief 版本。
- 基于已批准版本创建新版本。

进入和离开条件
新建 Release 默认从本页开始。只有当前 ReleaseBriefVersion 获得批准后，才能继续选择 ProductFlow。
设计重点
页面需要明确区分“营销主张”和“已有证据能够证明的事实”。无法由 ProductCapability 或后续 Evidence 支撑的内容，应标记为需要人工批准，而不能悄悄当成事实使用。
5.2 /releases/:releaseId/sources（旧路由）

原页面目标
集中管理这次 Release 使用的截图、录屏、Logo、字体和音频等 SourceAsset，并检查素材是否可用。
为什么被替换
单纯展示素材文件不能回答三个关键问题：
1. 这份素材是执行哪个产品步骤产生的？
2. 它证明了哪个 ProductCapability？
3. 它是否来自一次通过检查的 CaptureRun？
因此当前规范把这个阶段拆成 /flow 和 /evidence，建立完整的证据链：
FlowNode -> NodeEvidence -> SourceAsset
旧链接不应继续作为新功能入口。产品可以将它重定向到当前 Release 的 /evidence，或者返回明确的迁移提示。
5.3 /releases/:releaseId/flow（当前新增）

页面目标
为本次 Release 选择一个已经批准的 ProductFlowVersion，或者发起探索以创建新的 ProductFlow 草稿。
ProductFlow 描述的是一条有业务意义的产品操作路径。例如“创建项目 -> 导入数据 -> 生成报告”，而不是逐条展示鼠标点击记录。
页面主要内容
- 可复用 ProductFlow 列表。
- 每个 Flow 的版本、审批状态和最近验证时间。
- FlowNode 顺序及其证明的 ProductCapability。
- Agent 探索或 clean replay 的状态。
- 新建、选择、派生和批准 Flow 版本的入口。

核心操作
- 选择现有的已批准 ProductFlowVersion。
- 发起受控的产品探索。
- 审阅 Agent 归纳出的 FlowNode。
- 调整节点名称、顺序、Checkpoint 和 Capability 映射。
- 批准一个不可变版本，并把该版本固定到当前 Release。

页面边界
本页是 Release 的“使用视角”。它不能静默修改一个已经批准并被其他 Release 引用的版本。需要修改时，必须创建新版本。
5.4 /releases/:releaseId/evidence（当前替代 /sources）

页面目标
执行已选择的 ProductFlowVersion，并审阅这次 CaptureRun 产生的真实产品证据。
页面主要内容
- CaptureRun 总体状态和运行编号。
- 每个 FlowNode 的执行状态。
- 节点结果截图和视频片段。
- Checkpoint 和断言结果。
- 经清洗的 DOM 摘要。
- 素材来源、哈希、版本和脱敏状态。
- 失败节点、错误摘要和重跑入口。

核心操作
- 启动 CaptureRun。
- 查看运行进度。
- 审阅每个节点的 NodeEvidence。
- 重跑失败或证据过期的节点。
- 标记脱敏或事实问题。
- 批准本次 Evidence Package。

进入和离开条件
进入前必须固定一个已批准的 ProductFlowVersion。所有必需节点通过 Checkpoint、敏感信息处理完成且证据获得批准后，才可以生成 Storyboard。
设计重点
该页的重点不是做一个素材图库，而是让用户明确看到“主张与证据的可追溯关系”。验证状态不能只靠颜色表达，必须同时显示文字或图标。
5.5 /releases/:releaseId/storyboard

页面目标
把已批准的 Brief、ProductCapability 和 NodeEvidence 编排成一个结构化视频叙事。
Storyboard 是视频的叙事合同，不是自由拖拽的传统时间线。
页面主要内容
- Scene 列表及顺序。
- 每个 Scene 的主要信息、标题和辅助文案。
- 绑定的 ProductCapability 和 NodeEvidence。
- 布局、动效规则和目标时长。
- 总时长和渠道适配预览。
- Storyboard 版本、事实状态和审批状态。

核心操作
- 从 Brief 和 Evidence 生成初稿。
- 调整 Scene 顺序。
- 修改文案、证据绑定、布局和时长。
- 检查没有证据支撑的事实性 Scene。
- 提交审批、批准或驳回 StoryboardVersion。

进入和离开条件
进入前必须有已批准的 Evidence。StoryboardVersion 获得批准后，系统才能构建低成本视频预览并进入 Review。
设计重点
每个事实性 Scene 都必须显示其证据来源。用户修改上游 Brief、Flow 或 Evidence 后，受影响的 Scene 和预览应被标记为 stale，不能继续冒充最新结果。
5.6 /releases/:releaseId/review

页面目标
让团队审阅低成本视频预览，对事实、文案和视觉效果分别给出反馈，并决定是修改还是批准进入终稿制作。
页面主要内容
- 视频预览播放器。
- Scene 或时间点定位。
- 当前预览版本和生成状态。
- 事实、文案、视觉三类反馈。
- 未解决反馈和审批记录。
- 重新生成预览、返回 Storyboard、批准预览的操作。

核心操作
- 播放和定位预览。
- 在具体 Scene 上提交反馈。
- 将事实或文案问题退回 Storyboard。
- 在 Storyboard 不变时调整视觉方案并重新生成预览。
- 批准当前预览并冻结终稿输出要求。

进入和离开条件
进入前必须有已批准的 StoryboardVersion。当前预览通过质量检查且获得批准后，Release 才进入 final queued 阶段。
与 Storyboard 的区别
Storyboard 关注“视频应该如何组织”；Review 关注“生成出来的视频是否正确、可信并且可以发布”。
5.7 /releases/:releaseId/render（旧路由）

原页面目标
选择渲染参数、启动渲染，并单独查看渲染队列和进度。
为什么被移除
渲染本质上是后台任务状态，不是一项需要独立页面承载的用户工作。独立 Render 页面会让用户在 Review、Render 和 Artifacts 之间反复跳转，却没有产生新的业务决策。
当前设计将操作分配到两个页面：
- /review：发起预览、重新生成预览、批准预览并触发终稿。
- /artifacts：查看终稿渲染状态、失败原因和交付结果。
后台状态通过 SSE 或带游标轮询更新。旧 /render 链接应重定向到 /artifacts，不应重新实现独立页面。
5.8 /releases/:releaseId/artifacts

页面目标
集中展示后台任务状态和当前 Release 的最终交付物，让用户确认、下载和管理发布文件。
页面主要内容
- Preview 和 Final RenderJob 状态。
- 当前 RenderAttempt、进度、开始时间和错误信息。
- 不同画幅、分辨率、语言和渠道版本。
- MP4、封面图、字幕或质量报告等 Artifact。
- 文件大小、哈希、生成时间和版本来源。
- 下载、重试和复制交付链接等操作。

核心操作
- 查看正在进行的终稿渲染。
- 重试符合条件的失败任务。
- 下载单个 Artifact。
- 批量下载一次 Release 的交付物。
- 检查 Artifact 对应的 Brief、Storyboard、BrandKit 和模板版本。

页面状态
- final_queued：终稿等待执行。
- final_rendering：终稿正在生成，应显示实时进度。
- complete：所需 Artifact 全部发布完成。
- failed：保留失败前阶段，显示失败原因和允许的恢复操作。

设计重点
Artifacts 页既是任务状态页，也是交付页。页面必须区分“正在生成”“生成失败”“质量检查未通过”和“可以交付”，不能只展示一个模糊的百分比进度。
6. Release 页面之间的守卫关系
Release 页面不是可以任意跳过的普通标签页。后续页面依赖前面已经批准、不可变的版本。
暂时无法在飞书文档外展示此内容
访问尚未开放的后续页面时，前端应展示阻塞原因和返回入口，不能隐式创建缺失数据。Release、Product 和 Workspace 不匹配时应返回 404，避免泄露其他 Workspace 中对象是否存在。
Release 失败时，系统应同时保留：
- lifecycle = failed，表示整体生命周期状态。
- failedFromStage，表示失败发生在哪个制作阶段。
这样用户可以回到准确的上下文恢复工作，而不是被送回流程起点。
7. 页面职责边界总结
暂时无法在飞书文档外展示此内容

## 8. Stage A 落盘表

本节记录 2026-07-25 的 Stage A 路由骨架。`shell` 表示路由和导航真实存在，但业务数据与操作尚未接线；`wired` 表示当前已有真实运行链路；`legacy` 表示 CVC 过渡页面仍可访问。

### 8.1 路由到文件映射

| 路由 | 文件路径 | 状态 |
| --- | --- | --- |
| `/` | `src/app/(marketing)/page.tsx` | `wired` |
| `/login` | `src/app/(product)/login/page.tsx` | `shell` |
| `/signup` | `src/app/(product)/signup/page.tsx` | `shell` |
| `/dashboard` | `src/app/(product)/dashboard/page.tsx` | `shell` |
| `/products` | `src/app/(product)/products/page.tsx` | `shell` |
| `/products/[productId]` | `src/app/(product)/products/[productId]/page.tsx` | `shell` |
| `/releases` | `src/app/(product)/releases/page.tsx` | `shell` |
| `/releases/[releaseId]/brief` | `src/app/(product)/releases/[releaseId]/brief/page.tsx` | `shell` |
| `/releases/[releaseId]/flow` | `src/app/(product)/releases/[releaseId]/flow/page.tsx` | `shell` |
| `/releases/[releaseId]/evidence` | `src/app/(product)/releases/[releaseId]/evidence/page.tsx` | `shell` |
| `/releases/[releaseId]/storyboard` | `src/app/(product)/releases/[releaseId]/storyboard/page.tsx` | `shell` |
| `/releases/[releaseId]/review` | `src/app/(product)/releases/[releaseId]/review/page.tsx` | `shell` |
| `/releases/[releaseId]/artifacts` | `src/app/(product)/releases/[releaseId]/artifacts/page.tsx` | `shell` |
| `/releases/[releaseId]/sources` | `src/app/(product)/releases/[releaseId]/sources/page.tsx` | `shell`，308 到 `evidence` |
| `/releases/[releaseId]/render` | `src/app/(product)/releases/[releaseId]/render/page.tsx` | `shell`，308 到 `artifacts` |
| `/legacy` 及其子路由 | `src/app/legacy/(app)/**` | `legacy` |
| `/playbook` 及其子路由 | `src/app/playbook/**` | `legacy` |
| `/api/engine/*` | `next.config.ts` rewrite 到 PurpleInk worker | `wired` |

### 8.2 六步守卫矩阵

Stage A 只展示这些前置条件，不执行认证、数据库查询或自动创建。Stage B 接线时，访问未开放页面必须显示阻塞原因与返回入口。

| 步骤 | 路由 | 未来进入前置 | 未来主要数据来源 |
| --- | --- | --- | --- |
| Brief | `/releases/[releaseId]/brief` | Release 属于当前 Workspace | `Release`、`ReleaseBriefVersion`、`ProductCapability` |
| Flow | `/releases/[releaseId]/flow` | 当前 `ReleaseBriefVersion` 已批准 | `ProductFlowVersion`、`FlowNode`、`ProductCapability` |
| Evidence | `/releases/[releaseId]/evidence` | 已固定且批准 `ProductFlowVersion` | `CaptureRun`、`NodeEvidence`、`SourceAsset`、`EvidencePackage` |
| Storyboard | `/releases/[releaseId]/storyboard` | `EvidencePackage` 已批准 | `StoryboardVersion`、`Scene`、`NodeEvidence` |
| Review | `/releases/[releaseId]/review` | `StoryboardVersion` 已批准 | `Preview`、`ReviewFeedback`、`ApprovalRecord` |
| Artifacts | `/releases/[releaseId]/artifacts` | Preview 通过质量检查且已批准 | `RenderJob`、`RenderAttempt`、`Artifact` |

### 8.3 实现状态口径

| 状态 | 含义 | 当前路由 |
| --- | --- | --- |
| `shell` | 页面、参数等待、导航与明确 Stage B 占位已落盘；无数据库、引擎或认证接线 | `/login`、`/signup`、`/dashboard`、`/products*`、`/releases*` 新规范路由 |
| `wired` | 有真实运行链路并在 Stage A 做过运行验收 | `/`、`/api/engine/*`、CVC Next API |
| `legacy` | Stage A 保留的 CVC 过渡 UI；不代表新 Product/Release 域已实现 | `/legacy*`、`/playbook*` |

