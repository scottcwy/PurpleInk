# PurpleInk PRD

> 文档状态：Draft v0.3  
> 日期：2026-07-24  
> 面向读者：创始人、产品、设计、工程、增长  
> 视频引擎：HyperFrames

> **ProductFlow 更新：** ProductFlow、Playwright 浏览器采集、Release 路由和 `product-launch-video` 的产品定义以 [ProductFlow 与发布视频系统 Spec](./docs/specs/2026-07-23-product-flow-launch-video-system.md) 为准；可执行 schema、Capture Worker 协议、状态机和编译合同以 [Engineering Contracts](./docs/specs/2026-07-23-engineering-contracts.md) 为准。

## 0. 一句话结论

> **将经过验证的真实产品流程，持续转化为可审阅、可复现、可批量分发的发布视频。**

首个市场切口是高频发布的 Web SaaS、AI 产品和开发者工具。用户连接官网与受控 Demo 环境，提供一次发布目标，系统生成真实产品操作、结构化分镜和品牌化视频，并输出 16:9 与 9:16 的可发布版本。

HyperFrames 负责把确定性的 HTML/CSS/JavaScript composition 渲染为视频，但它不是产品价值本身。产品价值来自真实产品证据、叙事编排、品牌记忆、审批协作和持续再生产。

## 1. 产品决策摘要

### 1.1 我们决定做什么

做一个面向产品发布场景的 Agent-native 视频生产系统：

1. 从官网、发布说明和用户 brief 中理解发布目标。
2. 通过隔离的 Linux Playwright Worker 发现并执行批准的 ProductFlow，获得真实产品画面。
3. 把卖点、产品状态和真实画面组织成可审阅分镜。
4. 使用品牌模板生成发布级视频，而不是简单拼接录屏。
5. 将同一条产品故事批量输出为不同画幅、语言和渠道版本。
6. 保存产品、品牌、流程和模板，使下一次发布比第一次更快。



### 1.2 我们明确不做什么

MVP 不做：

- 对任意 URL 进行无边界、无人监督的自主探索。
- 完全无人监督的产品探索和能力声明。
- Premiere、CapCut 或 After Effects 式自由时间线编辑器。
- 通用 AI 视频生成平台。
- 以数字人、生成式 B-roll 或语音克隆作为核心卖点。
- 桌面应用、移动应用和游戏的自动操作采集。
- 未经授权访问客户生产环境。
- 允许模型生成或改写必须真实呈现的产品 UI。



### 1.3 核心战略判断

市场已验证“URL 变广告”“录屏自动后期”“交互 Demo”三类需求，

但这些产品通常依赖公开页面或已经发生的人工录制。真正值得争夺的缺口是：

> **系统能否可靠地证明产品做了什么，并把这份证据导演成可发布的视频。**

我们的竞争重点不是生成更多画面，而是同时做到：

- 产品画面真实。
- 产品流程可重复。
- 视频叙事可审阅。
- 品牌输出可持续。
- 多渠道版本可批量生成。



## 2. 背景与机会



### 2.1 当前用户如何制作产品视频

典型流程是：产品经理或市场人员写 brief，人工搭建测试数据，录屏，反复重录，

交给设计师或代理商剪辑，再补字幕、配音、音乐和多尺寸版本。

这个流程的问题不是单纯“剪辑慢”，而是多个环节彼此脱节：

- 脚本声称的功能与录屏中的真实状态可能不一致。
- 产品更新后，旧录屏和旧视频迅速失效。
- 重录无法稳定复现同样的数据、路径和结果。
- 16:9、9:16、多语言版本往往需要重复劳动。
- 修改一个卖点可能触发整条视频重新制作。
- 制作方很难回答某个镜头来自哪个产品版本和哪次运行。



### 2.2 为什么现在值得做

三个条件正在同时成熟：

1. 浏览器自动化可以生成可回放、可断言、可诊断的产品流程。
2. 大模型能够理解发布说明、网页内容和操作语义，并生成结构化分镜。
3. HyperFrames 等代码化视频引擎可以把网页组件、真实产品素材和动画确定性地渲染为 MP4。

单独看，每项技术都容易被替换；组合之后，产品可以从“一次性剪辑工具”变成“发布内容生产系统”。

### 2.3 最初市场窗口

优先服务以下产品：

- 产品通过浏览器交付。
- 发布频率高于每月一次。
- UI 是核心价值载体。
- 团队已有 staging/demo tenant 或可重复测试账号。
- 现阶段靠创始人、产品经理或市场人员临时制作视频。
- 对真实性、速度和品牌一致性同时有要求。

优先行业：AI SaaS、开发者工具、B2B SaaS、数据产品、工作流工具。

## 3. 用户与待完成任务



### 3.1 首要用户



#### 独立开发者和小型 SaaS 创始人

核心任务：在没有视频团队的情况下，为新产品或新功能快速产出可信、好看的发布视频。

痛点：会写产品但不擅长剪辑；产品迭代快；预算有限；发布时间敏感。

购买触发：Product Hunt 上线、版本发布、融资发布、官网改版、社媒宣传。

#### B2B SaaS 产品营销经理

核心任务：将产品更新转换为官网、销售和社媒可复用的视频资产。

痛点：依赖产品团队准备环境、依赖设计或代理商排期、需要多尺寸和多语言版本。

购买触发：季度发布、活动发布、销售 enablement、竞争回应。

#### 内容代理商和产品视频工作室

核心任务：用更少人工并行服务更多 SaaS 客户，同时维持稳定质量。

痛点：客户素材混乱、反复重录、修改链条长、品牌资产难以复用。

购买触发：项目毛利下降、客户需求增长、需要标准化交付。

### 3.2 暂不优先的用户

- 需要影视级自由创作的专业剪辑师。
- 主要制作真人、剧情、UGC 或电商广告的团队。
- 没有可控测试环境且不能提供录屏的企业。
- 只需要一次视频、没有持续发布需求的低频客户。



### 3.3 核心 Jobs to Be Done

当我准备发布一个产品或功能时，我希望系统能基于真实产品状态，快速生成一条符合品牌、能清楚证明价值的视频，使我不必重新组织录屏、脚本、剪辑和多渠道适配。

次级任务：

- 当产品 UI 更新后，只重采受影响的流程和镜头。
- 当目标渠道变化时，从同一份故事生成不同画幅和时长。
- 当目标市场变化时，生成不同语言的字幕和配音。
- 当团队审阅时，明确修改的是事实、文案、镜头还是视觉风格。



## 4. Core Value Battle



### 4.1 用户真正比较的不是视频引擎

用户不会因为我们使用 HyperFrames 而购买。用户会把我们与以下替代方案比较：

1. 自己录屏并用 CapCut、Premiere 或 Screen Studio 剪辑。
2. 把 URL 交给 AI 广告视频工具。
3. 使用 Trupeer、Guidde、Clueso 一类录屏后期工具。
4. 使用 Supademo、Storylane、Reprise 一类交互 Demo 工具。
5. 找自由职业者、设计师或视频代理商。
6. 放弃视频，只发布截图、GIF 和文字。



### 4.2 价值战场


| 战场    | 用户当前选择                | 我们必须提供的优势                          | 胜负标准                           |
| ----- | --------------------- | ---------------------------------- | ------------------------------ |
| 真实性   | 人工录屏最真实，生成式 UI 最不可靠   | 浏览器行为来自批准的 NodeEvidence；静态素材来自批准的 SourceAsset | 用户能定位镜头来源，视频不虚构产品能力            |
| 制作速度  | 模板工具快，代理商慢            | 首次 Release 30 分钟内得到可审阅草稿；复用 Release 10 分钟内得到草稿 | Time to First Reviewable Video |
| 可重复性  | 人工录屏和手工剪辑难以重做         | 保存 Flow、数据前置条件、分镜和品牌配置             | 同一 Flow 重跑成功率及 UI 更新后的修复成本     |
| 发布质量  | 录屏工具清楚但像教程；广告工具好看但不可信 | 真实 UI + 设计化构图 + 有节奏的叙事             | 无需外部剪辑即可发布的比例                  |
| 修改成本  | 改文案或 UI 后常需整条返工       | 事实、素材、文案、动画和渠道变量相互解耦               | 单个修改的平均重新制作时间                  |
| 品牌一致性 | 每条视频重新调样式             | 品牌包、字体、颜色、Logo、CTA 和镜头语言可复用        | 第二条视频的配置时间显著下降                 |
| 多渠道生产 | 画幅和语言需要重复编辑           | 同一 Storyboard 批量渲染多画幅、多语言版本        | 每个母版生成的有效变体数量                  |
| 审批与治理 | 反馈散落在聊天和时间码中          | 分镜级审批，区分事实、文案和视觉修改                 | 审批轮次和错误声明数量                    |




### 4.3 我们必须赢的三场战斗



#### Battle A：可信，不虚构

AI 视频工具可以生成更吸睛的画面，但不能可靠证明软件真实具备某项能力。我们的关键镜头必须来自：

- 经批准的用户录屏；或
- 带断言、检查点和运行记录的 ProductFlow。

系统必须允许用户查看镜头来源。模型可以润色文案，不能改变产品事实。

如果真实性无法建立，我们只是在做另一个模板视频工具。

#### Battle B：从一次制作变成持续生产

一次性生成一条视频不构成强产品。真正的价值来自复用：

- 品牌配置被保存。
- 产品卖点和受众被保存。
- ProductFlow 被保存。
- Storyboard 模板被保存。
- 渠道和语言变体可重新生成。

产品的关键留存事件不是“导出过一次视频”，而是“同一产品完成第二次发布”。

#### Battle C：发布级，而不是教程级

纯录屏后期容易变成操作教程；纯营销模板容易脱离产品。我们必须建立自己的导演语言：

- 先讲用户结果，再讲操作步骤。
- 每个产品镜头只证明一个价值点。
- 用缩放、遮罩、设备框、数据强调和字幕引导注意力。
- 控制信息密度、节奏和品牌一致性。
- 默认输出可以直接发布，而不是必须再次进入剪辑软件。



### 4.4 我们不打的战斗

- 不和通用剪辑器比自由度。
- 不和生成视频模型比想象力或电影画面。
- 不和数字人平台比角色数量。
- 不和交互 Demo 平台比销售互动分析。
- 不承诺理解所有网站和所有产品流程。
- 不用“用了 HyperFrames”作为差异化宣传。



### 4.5 核心价值排序

价值优先级不可颠倒：

```text
真实产品证据
  > 清楚的产品叙事
  > 发布级品牌表现
  > 生产速度
  > 变体数量
  > 炫技效果
```

任何功能如果提升视觉效果却降低产品真实性，应默认拒绝。

## 5. 产品原则

1. **事实先于表现。** 关键产品状态必须有来源，不能由模型重画。
2. **审批先于自动发布。** MVP 的 AI 产物必须可审阅，不直接对外发布。
3. **结构化先于自由编辑。** 用户修改 Storyboard 和场景属性，不直接维护 HTML。
4. **复用先于一次性魔法。** 第二次发布必须明显比第一次更快。
5. **有限模板先于无限生成。** 少量高质量模板比不稳定的任意视觉生成更有产品价值。
6. **失败可解释。** 采集、脚本、素材、渲染和交付错误必须能区分。
7. **引擎可替换。** HyperFrames 是 renderer，不进入核心业务数据合同。



## 6. 产品范围



### 6.1 MVP 输入

每个 Release 至少包含：

- 产品官网 URL。
- 产品名称和一句话定位。
- 本次发布说明或功能 brief。
- 目标受众。
- 目标渠道与画幅。
- 品牌 Logo、颜色和字体，可由官网提取后确认。
- 产品画面来源：Linux Playwright Capture Worker 执行 ProductFlow；每个 attempt 使用独立容器与 BrowserContext。



### 6.2 MVP 输出

- 一条 15 至 30 秒的 Feature Launch 产品发布视频。
- 16:9 主版本。
- 可选 9:16 社媒版本。
- 烧录字幕版本。
- Storyboard 和文案记录。
- 镜头到素材来源的关联。
- MP4 下载。



### 6.3 MVP 模板

MVP 只提供 1 套正式模板：

1. **Feature Launch**：问题、功能、操作证明、结果、CTA。
Product Overview 与 Developer Tool Launch 在首条纵向链路稳定后加入。

模板必须定义：

- 允许的场景类型。
- 推荐时长。
- 文案字数上限。
- 产品画面安全区域。
- 默认动效和转场。
- 16:9 与 9:16 的重排规则。



## 7. 核心用户体验



### 7.1 创建 Product 与 Release

用户先输入官网 URL 创建 Product，再为一次发布创建 Release。系统提取产品名、Logo、品牌色、字体候选、价值主张和公开媒体；所有结果进入确认页面，不能静默成为事实。

成功标准：用户在 3 分钟内完成品牌信息确认。

### 7.2 定义发布目标

用户回答四个问题：

1. 发布什么？
2. 谁应该在意？
3. 看完后应记住什么？
4. 看完后应执行什么行动？

系统生成一句核心信息和 3 至 5 个证明点。用户必须批准后才能进入分镜。

### 7.3 提供真实产品画面

MVP 以 ProductFlow 为唯一浏览器自动化模式：

#### ProductFlow 模式

用户在 Web 端创建 CaptureSession，Linux PlaywrightCaptureWorker 根据当前 approved ReleaseBriefVersion，在独立容器和 BrowserContext 中执行 DiscoveryRun。Agent 将操作归纳为 3 至 8 个语义 FlowNodes；用户批准 ProductFlowVersion 后，在新的隔离 attempt 中完成 clean CaptureRun，Worker 产生真实 NodeEvidence。

首次版本不提供无边界 Agent 探索。origin 跳转、登录、验证码和敏感确认必须 handoff 到同一个 cloud BrowserContext；支付、发布、删除、权限变更和其他外部副作用即使由用户接管也禁止进入可批准 Flow。

#### 上传素材

用户可上传已有录屏或关键截图作为显式 SourceAsset。Approved SourceAsset 可以支撑静态画面、品牌、字体和音频，但不能证明浏览器操作、状态变化或功能结果；也不能让 Golden Product 或 CaptureRun 在缺少真实 Playwright Evidence 时通过。

### 7.4 生成 Storyboard

系统生成场景列表，每个场景显示：

- 场景目标。
- 屏幕文案。
- 旁白文案。
- 使用的产品素材。
- 素材来源。
- 时长。
- 模板布局。

用户可以重新排序、删除、替换素材、修改文案和调整时长，但不能在 MVP 中自由拖动任意图层。

### 7.5 预览与审批

系统先生成低成本预览。用户按场景提交反馈：

- 事实错误。
- 文案修改。
- 素材错误。
- 视觉调整。
- 节奏调整。

事实错误优先级最高，并阻止最终导出。

### 7.6 渲染与交付

用户在生成 Plan 前选择 locale、字幕和配音；每个 locale 生成独立 LaunchVideoPlan 与 CompositionBundle。提交渲染时只选择该 Bundle 已包含的画幅与质量档。界面展示明确状态：排队、准备素材、渲染、质量检查、完成或失败。

成功输出包括视频、封面帧和 Release 输入版本。失败必须保留可重试的 Release 状态。

## 8. 功能需求



### 8.1 Product、Release 与品牌

- FR-01：用户可以创建和归档 Product，并创建、复制或取消 Release。
- FR-02：系统可以从公开官网提取候选品牌信息。
- FR-03：用户必须确认或覆盖提取结果。
- FR-04：BrandKit 可以在同一 Product 的多个 Releases 之间复用；跨 Product 禁止隐式复用。
- FR-05：每次品牌修改必须产生版本记录。



### 8.2 Brief 与叙事

- FR-06：用户可以输入发布说明、目标受众、核心结果和 CTA。
- FR-07：系统生成核心信息和证明点。
- FR-08：系统不得把未提供或未验证的信息写成产品事实。
- FR-09：Storyboard 必须由结构化场景组成。
- FR-10：每个事实型 Scene 必须关联一个 ProductCapability 和 approved EvidenceRef；浏览器行为事实必须引用 NodeEvidence。



### 8.3 素材与采集

- FR-11：支持上传 MP4、PNG、JPEG、Logo 和字体。
- FR-12：系统记录素材来源、创建时间、workspace、Product 和 Release/EvidencePackage 归属。
- FR-13：DiscoveryRun 与 CaptureRun 必须记录 node/action 状态、失败和检查点。
- FR-14：失败的 CaptureRun、未批准的 EvidenceRef 或未冻结的 EvidencePackageVersion 不能进入 Storyboard 和最终渲染。
- FR-15：用户可以批准、拒绝或替换某个采集片段。
- FR-16：系统必须提供敏感信息遮罩或拒绝机制。



### 8.4 模板与 Composition

- FR-17：Storyboard 可以映射到指定模板。
- FR-18：用户可以修改模板暴露的颜色、字体、Logo、文案、时长和素材。
- FR-19：`product-launch-video` 只生成 LaunchVideoPlan；确定性 compiler 将其编译为版本化 Composition Bundle。
- FR-20：Composition 与 LaunchVideoRunner 不得读取浏览器登录态或 local_secret；Capture Worker 只能通过短期 workload identity 在内存或 tmpfs 解密当前 Product 的 KMS envelope-encrypted reference。
- FR-21：Composition 的所有媒体和字体必须在编译前本地化；渲染时不允许读取外部 URL。



### 8.5 预览、审批和导出

- FR-22：用户可以查看场景级预览和整片预览。
- FR-23：反馈必须关联 Release 输入版本和 Scene。
- FR-24：事实错误状态会阻止最终导出。
- FR-25：支持 1080p MP4 导出。
- FR-26：支持 16:9 和 9:16，第二画幅允许重新排版而不是简单裁切。
- FR-27：渲染任务失败后可以在不丢失编辑状态的情况下重试。
- FR-28：系统保存渲染版本、输入版本和产物关联。



## 9. 产品级数据对象

以下是产品语义，不限定具体技术实现：


| 对象                | 含义                    |
| ----------------- | --------------------- |
| Workspace         | 团队与权限边界               |
| Product           | 被持续制作内容的产品            |
| BrandKit          | Logo、颜色、字体、语气和 CTA 规则 |
| ReleaseBrief      | 一次发布的目标、受众、卖点和渠道      |
| ProductCapability | 产品对用户可见、可由 FlowNode 证明的功能点 |
| ProductFlow       | Product 所拥有、可复用的业务步骤图     |
| ProductFlowVersion | 经批准、不可变的 ProductFlow 版本   |
| FlowNode          | 有业务意义的产品步骤，包含 actions 和 assertions |
| CaptureRun        | ProductFlowVersion 的一次 clean execution |
| NodeEvidence      | FlowNode 执行产生并可追溯的截图、片段与断言 |
| SourceAsset       | 截图、录屏、Logo、字体、音频等来源资产 |
| EvidencePackageVersion | Release 冻结的 approved EvidenceRef 集合与 provenance |
| Storyboard        | 场景顺序和叙事合同             |
| Scene             | 单个叙事目标、文案、素材和时长       |
| Template          | 可复用的视觉与运动设计系统         |
| CompositionBundle | 一个 locale 的 Storyboard 编译后的不可变可渲染输入 |
| RenderJob         | 某个 Bundle、画幅和质量档的渲染任务       |
| Artifact          | MP4、预览、封面和质量报告        |


核心追溯关系：

```text
ReleaseBrief
  -> ProductFlowVersion
  -> CaptureRun
  -> EvidencePackageVersion
  -> Storyboard
  -> Scene
  -> EvidenceRef
  -> CompositionBundle
  -> RenderJob
  -> Artifact
```



## 10. 质量标准



### 10.1 事实质量

- 视频不得声明 approved EvidenceRef 未证明的能力；浏览器操作、状态变化和功能结果必须由 NodeEvidence 证明。
- 产品操作必须使用真实录屏、真实截图或批准的同源 UI composition。
- 所有事实型镜头必须可定位来源。
- 敏感数据、个人信息和测试凭据不得进入最终画面。



### 10.2 视觉质量

- 文字不能溢出、重叠或低于最低可读对比度。
- 16:9 和 9:16 必须分别布局。
- 产品 UI 在常规观看尺寸下必须可辨认。
- 动画必须确定性、可 seek，不依赖真实时间或随机状态。
- 所有关键采样帧必须通过空白、裁切和遮挡检查。



### 10.3 叙事质量

- 前 3 秒说明产品类别、用户问题或明确结果。
- 每个场景只承担一个主要信息任务。
- 核心功能必须由真实产品画面证明。
- CTA 必须与 ReleaseBrief 一致。
- 15 至 30 秒 Feature Launch 原则上包含 3 至 5 个主要 beats。



### 10.4 系统质量

- 相同输入版本应得到视觉等价的输出。
- 渲染失败不能生成误导性的成功产物。
- 失败原因必须区分素材、Composition、浏览器、编码和系统错误。
- 已成功产物不能被失败重试覆盖。



## 11. 成功指标



### 11.1 北极星指标

**每个活跃 Product 每月获得批准并导出的发布视频数量。**

这个指标同时反映用户是否获得价值、是否完成审批，以及产品是否进入持续发布流程。

### 11.2 激活指标

- 完成官网与品牌提取确认的 Product 比例。
- 完成首个 Storyboard 的 Release 比例。
- 在首次会话中得到可审阅预览的 Release 比例。
- Time to First Reviewable Video，目标小于 30 分钟。



### 11.3 质量指标

- 无外部剪辑直接发布率，MVP 目标大于 50%。
- 首次 Storyboard 保留的场景比例，目标大于 60%。
- 首次预览批准率。
- 事实错误发生率，目标低于 1%。
- 最终渲染成功率，目标大于 98%。



### 11.4 留存指标

- 30 天内创建第二个 ReleaseBrief 的 Product 比例。
- 第二条视频相对第一条视频的制作时间下降幅度。
- BrandKit、ProductFlow 和模板的复用率。
- 每个母版生成的渠道或语言变体数。



### 11.5 商业指标

- 每条获批视频的人力介入分钟数。
- 每分钟成片的计算和第三方服务成本。
- Workspace 试用转付费率。
- 代理商账户每月服务的 Product 数。
- 毛利率和超额渲染成本。



## 12. 商业模式假设



### 12.1 建议的计费单位

不建议只按“生成次数”收费，因为失败渲染和低质量草稿会制造价值争议。建议采用：

- 基础订阅：Workspace、Product 数、品牌包、成员与存储。
- 成功产物额度：按最终导出分钟或批准视频计费。
- 增值项：多语言配音、4K、额外 ProductFlow、API、私有模板、企业治理。



### 12.2 初步套餐假设



#### Creator

面向独立开发者。1 个 Product，有限导出分钟，标准模板和 1080p。

#### Team

面向 SaaS 团队。多个 Product、团队审批、品牌包、ProductFlow 和多画幅输出。

#### Studio

面向代理商。客户隔离、批量 Releases、私有模板、白标和更高并发。

具体价格不在本 PRD 中锁定，需要通过 concierge 阶段验证客户对“单条视频”“持续发布能力”和“替代代理商成本”的实际支付意愿。

## 13. Go-to-Market



### 13.1 首个楔子

从开发者工具和 AI SaaS 开始，原因是：

- 发布频率高。
- 官网和产品 UI 通常可通过 Web 访问。
- CLI、Dashboard 和代码片段适合 HTML composition。
- 创始人愿意尝试 Agent-native 工具。
- GitHub Release、Product Hunt 和 X 提供明确分发场景。



### 13.2 首个可销售服务

不要等待全自动产品完成。先销售一个标准化服务：

> 48 小时内，把一次 SaaS 功能发布制作成 15 至 30 秒视频，并将 ProductFlow、证据和品牌资产保留给下次发布复用。

后台允许人工审核和调整，但每次人工操作都应记录为未来产品需求证据。

### 13.3 获客内容

- 同一产品从 release note 到成片的公开案例。
- 人工录屏与 verified flow 生成结果的对比。
- 16:9、9:16、多语言批量输出展示。
- “产品更新后仅重做受影响镜头”的演示。
- 开发者工具和 AI SaaS 的可复用模板案例。



## 14. MVP 阶段计划



### 阶段 0：Concierge 验证

目标：验证用户愿意为“发布视频结果”付费，而不是为生成技术付费。

范围：

- 人工接收 URL、brief、品牌和录屏。
- 使用内部 Storyboard Schema。
- 使用 3 套 HyperFrames 模板。
- 人工质量检查后交付 MP4。

退出条件：

- 至少 10 个不同 Product 完成付费或明确价格测试。
- 至少 3 个 Product 在 30 天内制作第二条视频。
- 至少 50% 成片无需外部剪辑即可发布。



### 阶段 1：ProductFlow Guided Self-Serve

目标：用户可以自己完成 brief、ProductFlow 采集、Storyboard 审批和导出。

范围：

- Product 与 BrandKit。
- 官网提取和确认。
- ProductFlow 节点图。
- Linux Playwright DiscoveryRun、clean CaptureRun 与真实 NodeEvidence。
- 隔离容器、BrowserContext、BrowserProfile、remote handoff 与凭据生命周期。
- Storyboard 编辑。
- 预览、反馈和渲染任务状态。
- 16:9 和 9:16。

退出条件：

- 中位首个可审阅视频时间小于 30 分钟。
- 最终渲染成功率大于 98%。
- 人工介入时间低于每条视频 20 分钟。



### 阶段 2：ProductFlow Reliability

目标：将 ProductFlow 采集从 happy path 强化为可靠、可诊断的重复能力。

范围：

- Playwright Worker 断线恢复、attempt fencing 和镜像版本兼容。
- 经批准的 ProductFlowVersion。
- Locator、断言、Trace 和 NodeEvidence。
- 镜头来源追溯。
- UI 变化后的失败诊断。

退出条件：

- 黄金 Flow 无产品变更时重跑成功率大于 95%。
- 至少 30% 活跃 Product 使用 ProductFlow 生成第二条视频。
- 事实错误率低于 1%。



### 阶段 3：Continuous Release Video

目标：进入团队发布流程，建立持续留存。

范围：

- GitHub、Linear 或发布系统触发。
- Release Diff 到 Storyboard 建议。
- 受影响镜头检测与局部重采。
- 多语言和多渠道批量生成。
- API 与团队治理。



## 15. 风险与应对



### 15.1 产品风险：用户只需要一次视频

应对：以高频发布团队为 ICP；将 BrandKit、Flow 和模板复用作为核心体验；重点衡量第二次发布。

### 15.2 市场风险：被理解为另一个 AI 视频工具

应对：对外强调 verified product story、真实 Demo 和持续发布；不把 prompt、模型或 HyperFrames 放在主标题中。

### 15.3 质量风险：自动生成结果不够发布级

应对：模板数量受控；建立严格文案和布局约束；MVP 保留人工审核；质量指标优先于生成数量。

### 15.4 可靠性风险：ProductFlow 容易因 UI 更新失败

应对：只运行批准的 ProductFlowVersion；优先稳定 test id 和语义 Locator；保留断言、Trace 和失败截图；支持人工修复并产生新版本。

### 15.5 安全风险：系统接触客户凭据和产品数据

应对：BrowserProfile 按 workspace 与 Product 隔离，只保存 KMS envelope-encrypted reference；Worker 使用短期 workload identity，只在内存或 tmpfs 解密；使用短期 CaptureSession、origin allowlist、DNS 后 SSRF 检查和日志脱敏；采集与渲染分离；凭据明文不得进入数据库、工作流 payload、日志、Evidence、trace 或 Composition。

### 15.6 平台风险：过度绑定 HyperFrames

应对：Storyboard、Scene、Asset 和 RenderJob 使用内部合同；HyperFrames 只实现 renderer adapter；固定版本并保存 Composition Bundle。

### 15.7 成本风险：视频渲染和第三方语音侵蚀毛利

应对：先提供低成本预览，再提交最终渲染；按最终产物额度计费；缓存相同输入；记录每个任务的实际成本。

### 15.8 法律与许可风险

应对：确认 HyperFrames Apache 2.0 的 NOTICE 和再分发要求；不默认获得 HyperFrames 商标使用权；所有字体、音乐、设备模型和客户素材记录许可来源。

## 16. Kill Criteria

满足以下任一条件时，应暂停扩大研发并重新评估定位：

- 10 个目标客户中少于 3 个愿意为首条成片付费。
- 首条视频可用，但几乎没有客户在 60 天内制作第二条。
- 为达到发布质量，每条视频长期需要超过 60 分钟专业人工剪辑。
- 目标客户无法接受受控 cloud BrowserContext 登录或 remote handoff，导致 Playwright 采集无法完成。
- 真实产品画面并非购买驱动，用户只愿购买低价通用广告模板。
- HyperFrames 在固定环境下仍无法达到可接受的确定性和渲染成功率。



## 17. 关键待验证假设



### 价值假设

- 用户愿意为“真实且可重复”支付高于普通 URL-to-video 的价格。
- 用户认为发布视频是持续需求，而不是一次性采购。
- 无外部剪辑直接发布率可以达到 50% 以上。



### 体验假设

- 结构化 Storyboard 足以覆盖大部分修改，不需要完整时间线编辑器。
- 一套高质量 Feature Launch 模板可以验证首批 ICP 的核心发布场景。
- 用户愿意先确认核心信息和证明点，再等待视频生成。



### 技术假设

- HyperFrames 可以在固定容器中稳定批量渲染目标模板。
- 同一 Storyboard 可以可靠重排为 16:9 和 9:16。
- 批准的 ProductFlowVersion 可以在没有产品变更时保持 95% 以上 clean replay 成功率。



### 商业假设

- 小团队愿意为持续发布能力订阅，而不是只按单条外包价格比较。
- 代理商会把私有模板和客户隔离视为高价值能力。
- 最终导出分钟和 Product 数可以形成可理解、可持续的计费模型。



## 18. 当前决策与开放问题



### 已决定

- 产品面向 Web SaaS 发布视频，不做通用视频生成。
- 真实 UI 是关键产品事实来源。
- HyperFrames 是首选渲染引擎候选，但不进入核心业务合同。
- MVP 使用结构化 Storyboard，不做自由时间线。
- MVP 以 1 套 Feature Launch 模板和人工质量审核开始。
- 所有浏览器自动化只使用 Linux Playwright Capture Worker，没有 Ego、Local Bridge 或其他执行器回退。
- `product-launch-video` 只生成 LaunchVideoPlan，Composition 由确定性 compiler 生成。
- 先验证第二次发布和持续复用，再扩大自动化范围。



### 待决定

- 产品正式名称与品牌定位。
- 首批 ICP 是独立开发者还是 10 至 100 人 SaaS 团队。
- 首条视频按 Release 收费还是直接进入订阅。
- 预览使用低分辨率完整渲染还是场景级即时预览。
- 配音后置；MVP 不要求 TTS。
- 是否将 GitHub Release 作为首个外部触发集成。



## 19. 术语表


| 术语           | 定义                                         |
| ------------ | ------------------------------------------ |
| Product      | 被持续制作视频的客户产品，不等同于一次视频项目                    |
| ReleaseBrief | 一次发布的视频目标、受众、卖点和 CTA                       |
| Verified     | 关键产品画面或事实能够回溯到批准素材或 NodeEvidence              |
| ProductFlow  | Product 所拥有、由业务步骤节点组成的可复用流程图                |
| FlowNode     | 一个有业务意义的产品步骤，包含浏览器 actions 和 assertions       |
| CaptureRun   | ProductFlowVersion 的一次正式 clean execution        |
| NodeEvidence | CaptureRun 中某个 FlowNode 产生的可追溯证据              |
| Storyboard   | 场景顺序、目标、文案、素材和时长的结构化合同                     |
| Composition  | 渲染引擎消费的具体画面与动画实现                           |
| Template     | 将 Storyboard 映射为视觉布局和运动语言的规则集合             |
| Renderer     | 将 Composition 转换为视频产物的引擎；首选候选是 HyperFrames |
| Artifact     | 最终 MP4、预览、封面、质量报告等产物                       |




## 20. 参考依据

- [ProductFlow 与发布视频系统 Spec](./docs/specs/2026-07-23-product-flow-launch-video-system.md)
- [PurpleInk Engineering Contracts](./docs/specs/2026-07-23-engineering-contracts.md)
- [Verified Product Video SaaS 技术设计](./2026-07-20-nextjs-hyperframes-saas-architecture.md)
- [Silicon Valley Launch Video Research](./docs/2026-07-23-silicon-valley-launch-video-research.md)
- [Software Launch Video Template Shortlist](./docs/2026-07-23-software-launch-video-template-shortlist.md)
- [PurpleInk 领域词表](./CONTEXT.md)
