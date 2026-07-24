# PurpleInk Route UI Authoring Spec

> 状态：Accepted v2  
> 日期：2026-07-24  
> 范围：认证路由、现有产品路由及未来新增产品路由  
> 目的：直接约束前端 Agent 如何把产品合同编写成 PurpleInk 页面  
> 设计执行器：Impeccable

## 1. 冻结结论

1. 本 Spec 是认证页和产品页的 UI 编写合同。实现者不得自行发明页面骨架、信息层级、品牌角色或路由职责。
2. 页面采用“全局页面语法 + 路由清单”两层治理。每个路由只允许声明一个主 archetype。
3. 新建或重写路由必须由 Impeccable 执行 `shape -> implementation -> audit -> fix -> polish -> re-audit`。
4. 本 Spec 必须可独立执行；Impeccable 的临时建议不能静默覆盖仓库合同。
5. UI 只转译已接受的产品行为，不得发明实体、状态机、权限、命令、数据或后端能力。
6. 营销首页 `/` 不使用本文的产品页面骨架。它继续以 `DESIGN.md`、`app/globals.css` 和 `app/page.tsx` 为视觉事实源。
7. 不冻结全局状态矩阵。每个路由需要哪些 loading、empty、error、success 或恢复状态，由 Agent 在 Impeccable 流程中依据真实产品合同判断。

## 2. 规范优先级

发生冲突时按以下顺序处理：

1. 已接受的产品与工程 Spec：决定业务事实、权限、状态转换和数据边界。
2. 本 Spec：决定路由页面语法、archetype、密度和编写流程。
3. `docs/specs/2026-07-24-ui-platform.md`：决定 UI 技术栈、Token API、基础组件和组件治理。
4. `DESIGN.md` 与 `app/globals.css`：决定 PurpleInk 品牌视觉、颜色、字体和效果。
5. `docs/frontend-route-guide.md`：解释当前路由的用户目标、内容和页面关系。
6. Impeccable 本次执行结果：在上述边界内完成具体 UX/UI 判断。
7. 相邻已交付页面：仅作为实现证据，不得把历史偏差升级为规范。

如果 Impeccable 与第 1-5 项冲突，Agent 必须指出冲突并停止相关设计决定。若产品行为或数据合同缺失，标记：

```text
BLOCKED: PRODUCT DECISION REQUIRED
```

允许在数据合同明确时实现静态壳层；禁止用假数据、无效按钮或前端本地状态伪造已完成的产品能力。

## 3. 强制 Impeccable 流程

每个新路由或完整重写必须独立通过以下流程。局部修复可缩小 target，但不得跳过与改动风险相关的阶段。

| 阶段           | 强制动作                                                                                              | 必须产出             | 完成门槛                                          |
| -------------- | ----------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------- |
| Context        | 运行 Impeccable context，读取 `PRODUCT.md`、`DESIGN.md`、相关产品 Spec、route guide、Token 和相邻页面 | 事实源清单           | 未读取事实源不得设计                              |
| Shape          | 使用 Impeccable `shape` 明确用户、任务、真实数据、页面结构、状态判断、响应式和边界                    | Route Brief          | Brief 与产品合同无冲突                            |
| Implementation | 按已确认 Route Brief 编写完整页面；自然语言实现请求或兼容的 `craft` alias 均可触发                    | 可运行页面与必要测试 | 不保留假交互或未解释占位                          |
| Audit          | 使用 Impeccable `audit` 做 a11y、性能、theming、responsive 和 implementation integrity 检查           | 分级 Audit Report    | 每条 finding 已验证，不报未经核实的 detector 命中 |
| Fix            | 按 P0、P1、P2 顺序修复 Audit finding                                                                  | 修复后的完整路径     | P0/P1 清零；P2 要么修复，要么记录窄范围理由       |
| Polish         | 使用 Impeccable `polish` 检查整条真实路径，而不是单张截图                                             | 完整交互与视觉收尾   | 不以 polish 偷渡重设计                            |
| Re-audit       | 重跑 audit，并执行仓库 lint、typecheck、测试、build 和浏览器验证                                      | 验收证据             | 满足 UI Platform Spec 的完成条件                  |

`craft` 在当前 Impeccable 中是 deprecated alias，不拥有独立质量语义。流程的硬要求是先完成 `shape`，再执行实现；不得依赖 alias 名称本身保证质量。

Route Brief 至少记录：

- 路由与主 archetype。
- 用户到达时的上下文、唯一首要任务和可观察成功结果。
- 进入条件、真实数据来源和对应产品 Spec。
- 区域顺序、每区内容、页面级主操作和上下文操作。
- Agent 判断为适用的状态、内容范围和恢复路径；不要求填写统一状态矩阵。
- 桌面、移动、键盘、缩放和 reduced-motion 行为。
- 明确非目标、仍被阻塞的产品决定和不可自行发明的内容。

## 4. 产品 UI 场景

产品控制台的物理场景是 **calm release room**：用户在发布期限下长时间检查事实、版本、运行状态和交付结果。界面必须冷静、精确、可扫描，品牌表达服务于任务，不把操作面变成营销展示。

| 角色       | 规则                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------- |
| 普通工作面 | 纯白背景、近黑正文、Neutral 边界，承载表单、列表、详情和审批                                |
| Night 表面 | 只用于固定 Sidebar、媒体检查区和 Workbench 等需要视觉隔离的工作空间                         |
| Indigo     | 只表达主操作、选择、焦点、品牌能量和受控 motion                                             |
| Green      | 只表达可追溯的 Verified / approved proof，并始终配文字或图标                                |
| Signal     | 使用既有语义 Token 表达变化、阻塞、警告和待审阅；不得另造状态色                             |
| Typography | Geist 用于标题、正文和控件；Geist Mono 只用于 ID、版本、时间、尺寸、hash、run 和 checkpoint |
| Imagery    | Evidence、Preview、Artifact 和真实产品截图是产品内容，不得用装饰图或渐变占位代替            |

禁止把控制台做成全紫渐变 SaaS、统一全深色后台、营销 Hero 拼盘、卡片瀑布流或装饰性 dashboard。禁止 gradient text、重复 eyebrow、编号 section 脚手架、嵌套 Card、玻璃拟态和无业务含义的大指标。

## 5. App Shell 与页面 anatomy

### 5.1 全局壳层

- 桌面端使用固定 Workspace Sidebar，只承载 Dashboard、Products、Releases 和 Settings。
- 内容区顶部只承载当前页面标题、必要上下文和一个页面级主操作。
- 移动端使用顶部栏和 Sheet 导航，不使用底部 Tab。
- Product 内导航和 Release 步骤导航属于内容区二级导航，不进入 Workspace Sidebar。
- 全局壳层不得随业务路由复制；由共享 `components/control-plane` 组合拥有。

### 5.2 标准页面顺序

除 Auth 和 Workbench 外，页面自上而下固定为：

| 顺序 | 区域                        | 约束                                  |
| ---: | --------------------------- | ------------------------------------- |
|    1 | Breadcrumb / Entity context | 表达真实位置；不使用装饰性 eyebrow    |
|    2 | Page header                 | 标题、简短说明、一个页面级主操作      |
|    3 | Secondary navigation        | 只在实体或工作流内部出现              |
|    4 | Blocking status             | 阻塞、失效和权限问题必须持续可见      |
|    5 | Main content                | 直接承载任务；不额外包页面级浮动 Card |
|    6 | Contextual actions          | 靠近受影响对象，不与页面主操作竞争    |

Empty content 替换 Main content，不再嵌套空白 Card。持久错误放在受影响区域上方；Toast 只反馈短暂操作结果。Auth 省略 Breadcrumb 和二级导航。Workbench 使用 Toolbar、Canvas、Inspector 取代标准纵向页面流。

## 6. 页面 archetype

| Archetype       | 路由职责                       | 固定结构                                              | 默认密度                           |
| --------------- | ------------------------------ | ----------------------------------------------------- | ---------------------------------- |
| Auth            | 建立或恢复身份与 Workspace     | 品牌上下文 + 单一表单 + 账号切换入口                  | Focused                            |
| Overview        | 回答当前需要关注什么           | 工作摘要 + 待处理项 + 最近对象 + 失败/阻塞入口        | Operational                        |
| Collection      | 扫描、筛选、创建和进入同类对象 | 查询控制 + 列表/表格 + 分页或连续结果                 | Operational                        |
| Entity Detail   | 理解和维护一个持久对象         | 实体摘要 + 二级导航 + 领域区块                        | Operational                        |
| Guided Workflow | 完成 Release 的一个有守卫步骤  | Release context + 六步导航 + 当前任务 + 审批/推进动作 | Focused 或 Operational，由任务决定 |
| Workbench       | 操作高密度画板或媒体工作区     | 稳定 Toolbar + 主工作区 + Inspector                   | Immersive                          |

每个路由只能声明一个主 archetype。允许嵌入共享区块，禁止混合两个完整页面骨架。新增第七种 archetype 必须先修改本 Spec。

### 6.1 密度合同

| 密度        | 使用方式                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------- |
| Focused     | 单一输入或审阅任务；正文列通常保持约 `640-720px`，不得把表单拉满宽屏                        |
| Operational | 使用内容区可用宽度，以表格、列表和扫描层级组织信息；不得退化成同尺寸 Card 网格              |
| Immersive   | 尽量占满剩余 viewport；Toolbar、Canvas、媒体和 Inspector 使用稳定尺寸约束，不因动态内容跳动 |

## 7. 路由清单

以下清单决定每个现有路由的主 archetype、密度和页面构成。详细业务内容、守卫和状态以引用的事实源为准。

| 路由                                 | Archetype / 密度              | 页面必须围绕的任务                        | 主要构成                                                            | 业务事实源                                      |
| ------------------------------------ | ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| `/login`                             | Auth / Focused                | 登录并进入合法 Workspace 或原受保护位置   | 登录表单、会话反馈、注册链接                                        | route guide 3.1                                 |
| `/signup`                            | Auth / Focused                | 创建 User、Workspace 和成员关系           | 注册表单、校验反馈、登录入口                                        | route guide 3.2                                 |
| `/dashboard`                         | Overview / Operational        | 判断最近工作、待审批、失败与阻塞          | 最近 Product/Release、待处理项、失败任务、创建入口                  | route guide 4.1                                 |
| `/products`                          | Collection / Operational      | 扫描和管理长期 Product                    | 查询/筛选、Product 列表、创建与归档入口                             | route guide 4.2；product-flow Spec 1.1          |
| `/products/:productId`               | Entity Detail / Operational   | 理解 Product 及其可复用资产               | Product 摘要、URL、BrandKit、Capabilities、Release 与 Flow 入口     | product-flow Spec 1.1                           |
| `/products/:productId/flows`         | Collection / Operational      | 管理 Product 级 ProductFlow 资产库        | Flow 查询、版本/批准状态、验证时间、创建入口                        | product-flow Spec 1.1-1.2                       |
| `/products/:productId/flows/:flowId` | Workbench / Immersive         | 探索、编辑、验证并批准 ProductFlowVersion | Flow toolbar、线性 canvas、node inspector、run/version context      | product-flow Spec 1.2-1.4；engineering Spec 3-4 |
| `/releases`                          | Collection / Operational      | 跨 Product 管理 Release                   | 查询/筛选、Release 列表、阶段/状态、创建入口                        | route guide 4.3                                 |
| `/releases/:releaseId/brief`         | Guided Workflow / Focused     | 冻结受众、主张、渠道和 CTA                | Release context、六步导航、结构化 Brief、审批动作                   | route guide 5.1；engineering Spec 5             |
| `/releases/:releaseId/flow`          | Guided Workflow / Operational | 选择或建立 Flow 并固定批准版本            | 六步导航、可复用 Flow、版本/节点证据、探索与批准入口                | route guide 5.3；product-flow Spec 1.2          |
| `/releases/:releaseId/evidence`      | Guided Workflow / Immersive   | 执行 Flow 并审阅可追溯证据                | Run context、node execution、媒体证据、checkpoint、redaction 与批准 | route guide 5.4；engineering Spec 4.5-4.7       |
| `/releases/:releaseId/storyboard`    | Guided Workflow / Operational | 将 Brief 与 Evidence 编排成结构化叙事     | Scene 序列、copy、EvidenceRef、时长、事实与审批状态                 | route guide 5.5；engineering Spec 5-6           |
| `/releases/:releaseId/review`        | Guided Workflow / Immersive   | 审阅 Preview、反馈并批准终稿              | 播放器、Scene 定位、分类反馈、版本和批准动作                        | route guide 5.6；engineering Spec 5-6           |
| `/releases/:releaseId/artifacts`     | Guided Workflow / Operational | 观察终稿任务并取得可发布交付物            | Render status、Artifact 列表、provenance、下载与合法重试            | route guide 5.8；engineering Spec 5-6           |

`/releases/:releaseId/sources` 和 `/releases/:releaseId/render` 不是正式页面，不得实现新 UI；按产品合同重定向或展示迁移结果。

## 8. Agent 自主判断边界

Agent 必须自行判断并在 Route Brief 中记录：

- 当前路由实际适用的 loading、empty、partial、error、success、permission、stale、offline 和恢复状态。
- 数据量、文案长度、角色差异和任务频率对具体组件的影响。
- 断点内的 reflow、折叠、Sheet、overflow 和 sticky 行为。
- 是否需要 motion，以及 reduced-motion 下的等价反馈。
- 何处应使用 Table、List、Field、Alert、Dialog、Sheet、Popover、Tooltip、Canvas 或媒体控件。

上述判断必须满足产品合同、UI Platform Spec、PurpleInk Token 和 Impeccable audit；“Agent 自行判断”不授权修改业务事实、创建新组件体系或绕过可访问性。

## 9. 新路由模板

新增产品路由前，在实现 PR 或任务说明中填写：

```md
## Route Brief: /route

- Product authority:
- User and arrival context:
- Primary task:
- Observable success:
- Archetype:
- Density:
- Entry conditions and data:
- Ordered regions:
- Page-level primary action:
- Contextual actions:
- Applicable states and recovery:
- Desktop/mobile/keyboard behavior:
- Non-goals:
- Blocked product decisions:
```

如果现有六类 archetype 无法承载路由，先修改本 Spec，不得在页面代码中静默创造新骨架。

## 9.1 已确认的共享 Route Brief 合同

以下合同由 2026-07-24 的批量 Impeccable shape 确认，适用于第 7 节全部正式产品路由：

- 主要用户是独立 SaaS 创始人、产品营销团队和产品视频工作室；产品路由统一使用 Operate visitor mode。用户通常在发布期限下检查版本、证据、审批和交付状态。
- 受保护路由先验证 session、Workspace membership 和实体归属。跨 Workspace、Product 或 Release 的对象一律返回 404，不得泄露对象是否存在。
- 页面级主操作可随当前状态或角色改变，但同一时刻只能出现一个。上下文操作必须靠近受影响对象，不能与主操作竞争。
- 已明确授权的审批和关键流程 command 只向合法角色开放。缺少角色合同的操作不得由前端自行推断权限。
- mutation 遇到 revision conflict 时保留尚未提交的用户输入，重新读取最新版本并要求用户重新审阅；不得静默覆盖。
- loading 使用保持布局稳定的 Skeleton；持久错误使用区域 Alert；Toast 只反馈短暂操作结果。stale 必须持续显示失效对象、原因和返回阶段，不能只靠颜色表达。
- 桌面使用固定 Workspace Sidebar；移动端使用顶部栏和 Sheet 导航。`200%` 缩放按窄视口重排，不允许页面级横向溢出；表格只允许局部滚动或转成语义列表。
- 键盘路径必须包含 skip link、可见 focus、合理焦点顺序及 Dialog/Sheet focus trap。reduced motion 移除非必要转场，但保留全部内容、状态和完成反馈。
- 所有内容来自真实查询、领域 command 或明确标注的阻塞状态；禁止 fixture、前端临时数组和无效按钮冒充产品能力。

## 9.2 已确认的 Route Briefs

### `/login`

- **Product authority：** route guide 3.1；ProductFlow Spec 1.1。
- **User and arrival context：** 未登录、session 过期或从受保护深链到达的已有用户。
- **Primary task / observable success：** 建立合法 session；进入 `/dashboard`，或在权限允许时安全返回原路由。
- **Archetype / density：** Auth / Focused。
- **Entry conditions and data：** auth session、允许的返回位置和服务端认证结果；不得从客户端猜测会话。
- **Ordered regions：** 品牌上下文、持续会话反馈、邮箱/密码表单、注册入口。
- **Page-level primary action：** 登录。
- **Contextual actions：** 前往注册；只有产品合同补充后才能增加密码恢复。
- **Applicable states and recovery：** 提交中、通用认证失败、账号锁定、网络失败、session 过期、已登录重定向；错误不得泄露邮箱是否存在。
- **Responsive and input behavior：** 单列 Focused 表单；移动端保持 48px 控件；提交失败后焦点进入错误摘要并保留邮箱。
- **Non-goals：** 注册、Product/Release 创建、Workspace 管理。
- **Blocked product decisions：** 见 9.4 的认证合同。

### `/signup`

- **Product authority：** route guide 3.2；ProductFlow Spec 1.1。
- **User and arrival context：** 首次建立 PurpleInk 身份与 Workspace 的新用户。
- **Primary task / observable success：** 原子创建 User、Workspace 和 membership；进入空 Workspace 的 `/dashboard`。
- **Archetype / density：** Auth / Focused。
- **Entry conditions and data：** 服务端注册合同、姓名、工作邮箱、Workspace 名称和密码。
- **Ordered regions：** 品牌上下文、持续校验反馈、注册表单、登录入口。
- **Page-level primary action：** 创建 Workspace。
- **Contextual actions：** 前往登录。
- **Applicable states and recovery：** 提交中、字段错误、重复邮箱、服务失败和成功重定向；失败保留非敏感输入。
- **Responsive and input behavior：** 单列 Focused 表单；错误摘要可通过键盘到达；密码值不跨失败响应持久化。
- **Non-goals：** 自动创建示例 Product、Release 或 Artifact。
- **Blocked product decisions：** 见 9.4 的认证合同。

### `/dashboard`

- **Product authority：** route guide 4.1；ProductFlow Spec 1.1。
- **User and arrival context：** 已登录 Workspace 成员需要快速判断下一项工作。
- **Primary task / observable success：** 识别最近工作、待审批、失败和阻塞，并进入正确对象或 Release 当前阶段。
- **Archetype / density：** Overview / Operational。
- **Entry conditions and data：** 当前 Workspace 的 Product、Release、Approval、Capture job 和 Render job 聚合查询。
- **Ordered regions：** Workspace context、页面标题、阻塞摘要、待处理项、活跃 Release、最近 Product、失败任务。
- **Page-level primary action：** 无 Product 时为“添加 Product”，否则为“新建 Release”。
- **Contextual actions：** 打开 Product、Release 当前阶段或失败任务上下文。
- **Applicable states and recovery：** 首次空 Workspace、无待处理项、局部查询失败、运行中任务和失败任务；局部失败不得清空其他已加载区域。
- **Responsive and input behavior：** Operational 列表在窄屏按优先级纵向排列；键盘顺序先阻塞项后最近工作。
- **Non-goals：** 在 Dashboard 内完成领域对象编辑或审批表单。
- **Blocked product decisions：** 聚合查询、负责人字段及创建权限见 9.4。

### `/products`

- **Product authority：** route guide 4.2；ProductFlow Spec 1.1；Engineering Contracts 2.1。
- **User and arrival context：** Workspace 成员管理可跨 Release 复用的长期 Product。
- **Primary task / observable success：** 创建 Product 或进入目标 Product 的维护上下文。
- **Archetype / density：** Collection / Operational。
- **Entry conditions and data：** Product 名称、HTTPS canonical URL、状态、更新时间，以及可真实派生的 Release、Flow 和 BrandKit 摘要。
- **Ordered regions：** 页面标题、查询与筛选、Product 表格、分页或连续结果。
- **Page-level primary action：** 添加 Product。
- **Contextual actions：** 打开 Product、归档 Product；归档不得删除历史版本。
- **Applicable states and recovery：** loading、无 Product、无搜索结果、归档、分页失败、创建成功和 revision conflict。
- **Responsive and input behavior：** 桌面使用 Table；窄屏转成带完整 accessible name 的实体列表；筛选保持 URL 可恢复。
- **Non-goals：** 某次 Release 的制作状态和直接删除历史 Product。
- **Blocked product decisions：** CRUD 角色、确认规则和 BrandKit 完整度见 9.4。

### `/products/:productId`

- **Product authority：** ProductFlow Spec 1.1-1.2；Engineering Contracts 2.1。
- **User and arrival context：** 从 Product collection、Dashboard 或 Release 上下文进入长期资产详情的成员。
- **Primary task / observable success：** 理解 Product、URL 和可复用资产，并进入需要维护的 BrandKit、Capability、Flow 或 Release。
- **Archetype / density：** Entity Detail / Operational。
- **Entry conditions and data：** 同一 Workspace 的 Product、BrandKitVersion、ProductCapability、ProductFlow 和 Release 摘要；归属不匹配返回 404。
- **Ordered regions：** Breadcrumb、Product 标题与状态、Product 二级导航、URL、BrandKit、Capabilities、Flows、Releases。
- **Page-level primary action：** 新建 Release。
- **Contextual actions：** 编辑 Product、维护各领域资产、打开现有 Release。
- **Applicable states and recovery：** 404、已归档、部分资产为空、查询局部失败、版本 stale 和 revision conflict。
- **Responsive and input behavior：** Operational 区块保持扁平；二级导航可水平滚动；长 URL 可换行且可完整访问。
- **Non-goals：** 在 Product 详情中执行 Capture 或编辑某次 Release。
- **Blocked product decisions：** Product 更新权限、BrandKit payload 与完整度规则见 9.4。

### `/products/:productId/flows`

- **Product authority：** ProductFlow Spec 1.1-1.2；Engineering Contracts 2-3。
- **User and arrival context：** 维护 Product 级可复用 Flow 资产的成员。
- **Primary task / observable success：** 进入 approved FlowVersion 或合法建立新的 Flow aggregate/draft。
- **Archetype / density：** Collection / Operational。
- **Entry conditions and data：** ProductFlow、版本、审批状态、最近 clean replay、节点数、归档状态和 active DiscoveryRun。
- **Ordered regions：** Product context、页面标题、Product 导航、查询控制、Flow 表格。
- **Page-level primary action：** 新建 Flow；在 9.3 的探索上下文冲突解决前只能创建合法 aggregate，不能启动 DiscoveryRun。
- **Contextual actions：** 打开、派生或归档 Flow。
- **Applicable states and recovery：** 无 Flow、无筛选结果、draft、approved、验证过期、active discovery、查询失败和 revision conflict。
- **Responsive and input behavior：** 桌面 Table、移动语义列表；版本与状态同时用文字和图标表达。
- **Non-goals：** 静默修改 approved version 或从 Product 资产页固定 Release 引用。
- **Blocked product decisions：** 独立资产视角的合法创建/探索入口见 9.3 和 9.4。

### `/products/:productId/flows/:flowId`

- **Product authority：** ProductFlow Spec 1.2-2.5；Engineering Contracts 3-4。
- **User and arrival context：** 审阅和维护 ProductFlowVersion 的成员。
- **Primary task / observable success：** 将 3-8 个语义节点的 draft 通过 clean replay，并批准为不可变版本。
- **Archetype / density：** Workbench / Immersive。
- **Entry conditions and data：** ProductFlow DSL、FlowVersion、FlowNode、NodeExecution、Checkpoint、Evidence、DiscoveryRun 和 BrowserProfile revision。
- **Ordered regions：** 稳定 Toolbar、`@xyflow/react` 线性 Canvas、Node Inspector、run/version context。
- **Page-level primary action：** 当前 draft 满足 guard 时批准版本；approved 状态不显示 mutation 主操作。
- **Contextual actions：** 选择、重命名、排序、删除和合法重跑 draft 节点；查看 Action、Checkpoint、Evidence 和错误。
- **Applicable states and recovery：** 3-8 节点、draft、approved 只读、running、handoff、checkpoint failed、clean replay failed、验证过期和 revision conflict。
- **Responsive and input behavior：** 移动端 Canvas 保持可平移，Inspector 使用 Sheet；键盘提供等价节点列表、选择和排序命令；viewport 状态不进入 DSL。
- **Non-goals：** 分支、循环、多人实时编辑、trace viewer 和直接修改 approved version。
- **Blocked product decisions：** Product 资产视角如何获得 approved Brief 上下文见 9.3 和 9.4。

### `/releases`

- **Product authority：** route guide 4.3；ProductFlow Spec 1.1-1.4；Engineering Contracts 5。
- **User and arrival context：** Workspace 成员跨 Product 管理 Release。
- **Primary task / observable success：** 创建 Release，或进入现有 Release 的准确当前/失败恢复阶段。
- **Archetype / density：** Collection / Operational。
- **Entry conditions and data：** Release 名称、Product、lifecycle、stage、failedFromStage、更新时间和可真实派生的审批摘要。
- **Ordered regions：** 页面标题、查询与筛选、Release 表格、分页。
- **Page-level primary action：** 有 Product 时为“新建 Release”；无 Product 时为“添加 Product”。
- **Contextual actions：** 打开当前阶段、查看失败原因、执行合同允许的 retry 或 cancel。
- **Applicable states and recovery：** 空列表、无查询结果、active、failed、cancelled、delivered、分页失败和 revision conflict。
- **Responsive and input behavior：** 桌面 Table、窄屏实体列表；stage 与 lifecycle 分开朗读和展示。
- **Non-goals：** ProductFlow 资产维护和在列表中完成深度编辑。
- **Blocked product decisions：** 创建/取消角色、负责人字段和查询 API 见 9.4。

### `/releases/:releaseId/brief`

- **Product authority：** route guide 5.1；ProductFlow Spec 1.1-1.4；Engineering Contracts 2、5。
- **User and arrival context：** 新 Release 的编辑者或审阅当前 BriefVersion 的审批者。
- **Primary task / observable success：** 冻结受众、目标、Capability、事实主张、渠道和 CTA；approved BriefVersion 被固定并进入 Flow。
- **Archetype / density：** Guided Workflow / Focused。
- **Entry conditions and data：** 同一 Workspace/Product 的 Release、ReleaseBriefVersion、ProductCapability、Approval 和 revision。
- **Ordered regions：** Release context、六步导航、阻塞状态、结构化 Brief、版本与审批记录。
- **Page-level primary action：** 每个状态只显示“保存草稿”或合法审批者的“批准 Brief”之一。
- **Contextual actions：** 编辑字段、查看历史、拒绝候选、基于 approved version 创建后继版本。
- **Applicable states and recovery：** 初始 draft、字段错误、只读 approved、rejected、stale、revision conflict 和权限不足。
- **Responsive and input behavior：** `640-720px` Focused 正文列；错误摘要与字段关联；移动端操作不固定遮挡表单。
- **Non-goals：** 任意 Prompt、产品录制和视频编辑。
- **Blocked product decisions：** Brief payload、保存草稿和提交审批生命周期见 9.4。

### `/releases/:releaseId/flow`

- **Product authority：** route guide 5.3；ProductFlow Spec 1.2-2.5；Engineering Contracts 3-5。
- **User and arrival context：** Brief 已批准后，为当前 Release 选择或建立 Flow 的成员。
- **Primary task / observable success：** 固定一个 approved ProductFlowVersion，并推进到 `capture_pending`。
- **Archetype / density：** Guided Workflow / Operational。
- **Entry conditions and data：** approved Brief pin、Product URL、可复用 FlowVersion、DiscoveryRun、clean replay 和 Release revision。
- **Ordered regions：** Release context、六步导航、阻塞状态、Flow collection、选中版本节点摘要、discovery/run status。
- **Page-level primary action：** 按 stage 显示“使用此版本”“开始探索”或“批准版本”之一。
- **Contextual actions：** 查看版本、派生 draft、审阅节点和进入合法 handoff。
- **Applicable states and recovery：** 无可用 Flow、flow_selecting、flow_discovering、handoff、clean replay failed、flow_review、stale、failed 和权限不足。
- **Responsive and input behavior：** 列表与节点摘要在窄屏纵向排列；运行状态通过 live region 更新但不抢焦点。
- **Non-goals：** 静默修改 approved version 和在 Release 使用视角维护全部 Product 资产。
- **Blocked product decisions：** 现有 approved Flow 的选择 service 尚属工程交付缺口，见 9.5。

### `/releases/:releaseId/evidence`

- **Product authority：** route guide 5.4；ProductFlow Spec 1.3、2.4-2.5；Engineering Contracts 4-5。
- **User and arrival context：** 已固定 approved FlowVersion 后执行 Capture 并审阅证据的成员。
- **Primary task / observable success：** 完成所有必需 Evidence 决定并冻结 EvidencePackageVersion，推进 Storyboard generation。
- **Archetype / density：** Guided Workflow / Immersive。
- **Entry conditions and data：** CaptureRun、NodeExecution、Evidence Manifest、NodeEvidence、AssetVersion、Checkpoint、redaction 和 provenance。
- **Ordered regions：** Release context、六步导航、Run toolbar、Node execution rail、媒体检查区、Evidence inspector。
- **Page-level primary action：** `capture_pending` 时为“开始 Capture”，`evidence_review` 且 guard 满足时为“批准 Evidence”。
- **Contextual actions：** 批准/拒绝单项、查看 provenance、标记事实或脱敏问题；单节点重跑须等待 9.4 合同。
- **Applicable states and recovery：** pending、capturing、断线恢复、handoff、failed node、redaction blocked/needs_review、metadata 漂移、stale 和 approved 只读。
- **Responsive and input behavior：** 媒体保持稳定 aspect ratio；移动 Inspector 使用 Sheet；节点列表、媒体和决策均可键盘操作。
- **Non-goals：** 素材图库、叙事编排和用上传素材替代浏览器行为证据。
- **Blocked product decisions：** 单节点 retry/attempt 语义见 9.4。

### `/releases/:releaseId/storyboard`

- **Product authority：** route guide 5.5；ProductFlow Spec 1.1、3.4-3.6；Engineering Contracts 4.7、5-6。
- **User and arrival context：** Evidence 已批准后组织发布叙事的编辑者或审批者。
- **Primary task / observable success：** 将 approved Capability 与 EvidenceRef 编排成 3-5 个可追溯 Scene，并批准 StoryboardVersion。
- **Archetype / density：** Guided Workflow / Operational。
- **Entry conditions and data：** approved Brief、EvidencePackageVersion、StoryboardV1、Approval、stale dependency 和 revision。
- **Ordered regions：** Release context、六步导航、事实/stale 阻塞、Scene 序列、Scene 编辑区、provenance 与审批记录。
- **Page-level primary action：** guard 满足时批准 Storyboard。
- **Contextual actions：** 排序 Scene，编辑 headline/body，绑定合法 Capability 与 EvidenceRef，拒绝候选和创建后继版本。
- **Applicable states and recovery：** generating、draft、事实无证据、文案超限、stale、rejected、approved 只读和 revision conflict。
- **Responsive and input behavior：** 桌面序列与编辑区并列，窄屏顺序堆叠；排序必须提供键盘按钮，不能只依赖拖拽。
- **Non-goals：** 自由时间线、直接编辑视频、在 schema 外保存布局或动效。
- **Blocked product decisions：** Storyboard 与 LaunchVideoPlan 的布局、动效和时长归属见 9.3、9.4。

### `/releases/:releaseId/review`

- **Product authority：** route guide 5.6；ProductFlow Spec 1.1、3.5；Engineering Contracts 5-6。
- **User and arrival context：** Storyboard 已批准后审阅 landscape Preview 的成员和审批者。
- **Primary task / observable success：** 区分事实、文案和视觉问题；质量通过后批准当前不可变 Bundle 并进入 final queue。
- **Archetype / density：** Guided Workflow / Immersive。
- **Entry conditions and data：** PreviewArtifact、CompositionBundle、QualityReport、Scene/time mapping、Approval 和反馈记录。
- **Ordered regions：** Release context、六步导航、quality/stale 阻塞、播放器、Scene 定位、反馈与审批记录。
- **Page-level primary action：** 当前 Bundle 通过质量检查且无阻塞时批准 Preview。
- **Contextual actions：** 定位 Scene、记录分类反馈；事实/文案问题退回 Storyboard，视觉问题创建新 Plan/Bundle。
- **Applicable states and recovery：** queued、rendering、quality_failed、render_failed、unresolved feedback、stale、approved 和媒体加载失败。
- **Responsive and input behavior：** 播放器使用稳定 16:9；移动端反馈区下移；键盘支持播放、时间定位和 Scene 导航。
- **Non-goals：** 长期 Product 资产管理和自由视频剪辑。
- **Blocked product decisions：** feedback schema、unresolved 语义和 preview command API 见 9.4、9.5。

### `/releases/:releaseId/artifacts`

- **Product authority：** route guide 5.8；ProductFlow Spec 1.1、3.5-3.7；Engineering Contracts 5-6。
- **User and arrival context：** Preview 已批准后等待、检查或取得终稿交付物的成员。
- **Primary task / observable success：** 所需 Artifact 全部发布且用户能取得经过授权的交付文件。
- **Archetype / density：** Guided Workflow / Operational。
- **Entry conditions and data：** LaunchVideoJob、RenderJob、RenderAttempt、Artifact、QualityReport、provenance 和事件 cursor。
- **Ordered regions：** Release context、六步导航、Render status、当前 attempt、Artifact 表格、provenance。
- **Page-level primary action：** failed 且允许恢复时为“重试终稿”；complete 时为“下载全部”；运行中不显示 mutation 主操作。
- **Contextual actions：** 下载单个 Artifact、检查版本来源；分享链接须等待授权合同。
- **Applicable states and recovery：** final_queued、final_rendering、failed、quality_failed、complete/delivered、部分 Artifact、事件流断线和 stale。
- **Responsive and input behavior：** Artifact Table 在窄屏转列表；进度、阶段与失败原因通过文字表达；事件更新不移动当前焦点。
- **Non-goals：** 修改 approved Storyboard、重新选择语言/画幅或独立 Render 页面。
- **Blocked product decisions：** 下载、批量下载和分享授权见 9.4；Web 事件接口见 9.5。

## 9.3 Spec 冲突裁决

以下冲突不得由页面实现静默解决：

1. ProductFlow Spec 把 `/products/:productId/flows/:flowId` 定义为可发起 Agent 探索的资产视角，但 Engineering Contracts 要求 DiscoveryRun 必须绑定 Release 和 approved ReleaseBriefVersion。Engineering Contracts 优先；独立 Product workbench 在合同补充前不能直接启动 DiscoveryRun。
2. route guide 要求 Storyboard 编辑布局、动效和时长，但权威 `StoryboardV1` 只包含 Scene 顺序、Capability、claim type、headline、body 和 EvidenceRef。Engineering Contracts 优先；页面不得显示无法持久化的布局、动效或时长控件。
3. 第 5.1 节要求 Sidebar 包含 Settings，但第 7 节没有 `/settings` 正式路由。实现不得保留无效 Settings 按钮；新增入口前必须补充路由职责、权限和 Brief。

## 9.4 BLOCKED: PRODUCT DECISION REQUIRED

- 认证提供方、session/redirect 合同、账号锁定规则和完整密码策略。
- Product/Release CRUD 的角色权限、危险操作确认规则和查询合同。
- Dashboard 与 Release collection 所需“负责人”的字段归属；当前 `releases` 合同没有负责人字段。
- BrandKit “完整度”的规范计算方法。
- 独立 ProductFlow workbench 如何获得合法 approved Brief 上下文。
- ReleaseBrief payload schema、保存草稿 command，以及“提交审批”是否是独立状态。
- 单节点 Evidence 重跑的 command、attempt fencing 和下游失效语义。
- Storyboard 与 LaunchVideoPlan 对布局、动效和时长的职责归属。
- Review feedback 的持久化 schema、未解决状态和 command。
- Artifact 单个下载、批量下载和分享链接的授权及签名 URL 合同。
- `/settings` 的正式路由职责、数据和权限。

## 9.5 工程交付阻塞

以下能力已有部分产品意图或底层表结构，但当前仓库没有可供页面调用的完整 Web 边界。它们是工程交付缺口，不授权 UI 使用本地状态、fixture 或无效按钮替代：

- 登录、注册和受保护页面 session 读取。
- Product/Release 的查询、创建、更新、归档、取消与分页接口。
- Dashboard 聚合查询和页面级 Server Actions。
- ProductFlow 持久化查询/command；现有 `components/product-flow/flow-workbench.tsx` 仅使用客户端临时状态，不满足 DSL 事实源合同。
- `select_flow_version`、Preview feedback/approval、final retry 等页面 command 的服务边界。
- `GET /api/jobs/:id/events?cursor=` Web SSE/轮询接口。
- Artifact 授权下载与批量交付接口。

## 10. 验收

路由只有同时满足以下条件才算完成：

- Route Brief 已确认，且页面职责可追溯到已接受的产品 Spec。
- 页面符合其 archetype、密度、App Shell 和 anatomy，没有第二个竞争性页面骨架。
- 页面不包含虚构数据、不可执行主操作或未经合同授权的交互。
- Impeccable audit 的 P0/P1 已清零；保留的 P2 有窄范围书面理由。
- 键盘路径、可见 focus、语义名称、颜色独立状态和 WCAG 2.1 AA 满足 UI Platform Spec。
- 在 `360`、`390`、`768`、`1024`、`1440px` 与 `200%` 缩放下完成浏览器验证。
- reduced motion 保留内容、状态变化和任务完成能力。
- lint、typecheck、相关测试、生产 build 和关键浏览器 smoke test 通过。
- 最终 diff 不包含平行组件体系、硬编码业务颜色、无关重构或文档与代码漂移。
