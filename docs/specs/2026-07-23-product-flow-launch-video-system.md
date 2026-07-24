# PurpleInk ProductFlow 与发布视频系统 Spec

> 状态：Accepted v3  
> 日期：2026-07-24  
> 覆盖范围：应用路由、ProductFlow 节点图、`product-launch-video` 后端部署  
> 参考气质：Linear Releases，15-30 秒 Feature Launch，真实 UI 状态变化优先于教程式点击展示

> **工程合同：** 数据库、Flow DSL、Playwright Capture Worker API、Release 状态转换和视频编译以 [PurpleInk Engineering Contracts](./2026-07-23-engineering-contracts.md) 为唯一事实源；本文只定义产品行为与边界。

## 0. 冻结结论

1. **ProductFlow 是 Product 级资产。** 一个 ProductFlow 只属于一个 Product，可被多个 Release 复用。
2. **Release 固定引用不可变的 ProductFlowVersion。** 修改 Flow 必须创建新版本，不改变历史 Release。
3. **FlowNode 是有业务意义的产品步骤。** 底层点击属于 BrowserAction；产品功能点是 ProductCapability，并通过 `proves` 关联 FlowNode。
4. **MVP 先支持线性路径。** 数据合同保留 Edge，但每个普通节点最多一个前驱和一个后继；分支后置。
5. **PlaywrightCaptureWorker 是探索和采集的唯一浏览器执行器，视频 Skill 不操作线上产品。** `product-launch-video` 只消费已批准、不可变的 Storyboard、BrandKit 和 EvidencePackageVersion。
6. **Render 不是页面。** 它是后台任务状态；用户在 Review 发起预览/终稿，在 Artifacts 查看结果。
7. **所有浏览器自动化采用云端隔离 Playwright。** 每个 DiscoveryRun/CaptureRun 在 Linux 上启动独立、短生命周期的 Playwright 容器和 BrowserContext；不存在本地 Bridge 或第二执行器回退路径。

## 1. 项目路由 Spec

### 1.1 路由表

| 路由 | 页面职责 | 主要对象 |
| --- | --- | --- |
| `/login` | 登录 | User、Workspace |
| `/signup` | 注册和创建 Workspace | User、Workspace |
| `/dashboard` | 最近 Product、Release、失败任务和待审批项 | Product、Release |
| `/products` | Product 列表及创建入口 | Product |
| `/products/:productId` | Product 概览、URL、BrandKit、Capabilities | Product |
| `/products/:productId/flows` | 可复用 ProductFlow 资产库 | ProductFlow |
| `/products/:productId/flows/:flowId` | Agent 探索、节点编辑、运行记录、版本批准 | ProductFlowVersion |
| `/releases` | 跨 Product 的 Release 列表 | Release |
| `/releases/:releaseId/brief` | 受众、发布目标、卖点、CTA、渠道 | ReleaseBrief |
| `/releases/:releaseId/flow` | 选择或新建 ProductFlow，固定本次使用的版本 | ProductFlowVersionRef |
| `/releases/:releaseId/evidence` | 审阅本次 CaptureRun 的节点证据 | CaptureRun、NodeEvidence |
| `/releases/:releaseId/storyboard` | 将 Capability 与 NodeEvidence 编排为 Scenes | Storyboard |
| `/releases/:releaseId/review` | 审阅低成本视频预览，提交事实/文案/视觉反馈 | PreviewArtifact、Approval |
| `/releases/:releaseId/artifacts` | 查看任务进度、终稿、画幅与语言变体 | RenderJob、Artifact |

### 1.2 路由变更

旧路由中的 `/sources` 改为 `/evidence`。SourceAsset 仍是底层资产，但用户在该阶段审阅的是 `FlowNode -> NodeEvidence -> SourceAsset` 的完整证据链。

移除 `/releases/:releaseId/render`。渲染由 `/review` 或 `/artifacts` 发起，后台任务通过 SSE 或带游标轮询更新状态。

ProductFlow 同时有两个视角：

- `/products/:productId/flows/:flowId` 是资产视角，可创建和批准新版本。
- `/releases/:releaseId/flow` 是使用视角，只能选择某个已批准版本，或基于它派生草稿，不能静默改写原版本。

### 1.3 Release 导航与守卫

Release 顶部固定显示六步：

```text
Brief -> Flow -> Evidence -> Storyboard -> Review -> Artifacts
```

- Release、Product 和当前 Workspace 必须匹配，否则返回 404，不能泄露对象存在性。
- 未完成前置步骤时，后续页面只显示阻塞原因和返回入口，不隐式创建数据。
- 已批准版本只读；创建后继版本不影响任何 Release。只有用户显式执行带 revision/idempotency guard 的 `repin_*` command，才按 Engineering Contracts 的失效矩阵将当前 Release 下游标记为 `stale` 并返回对应审阅阶段。
- 页面刷新和深链接必须恢复同一 Release 状态，运行中任务不依赖客户端内存。

### 1.4 Release 状态

Release 使用独立的 `lifecycle` 与 `stage`，失败不覆盖失败前阶段。规范状态、command、guard、幂等和恢复行为见 Engineering Contracts 第 5 节。

## 2. ProductFlow 节点图 Spec

### 2.1 用户体验

节点图是 ProductFlow 的主要编辑界面，不是浏览器 trace viewer。

1. 用户输入产品 URL、探索目标和需要证明的 ProductCapabilities。
2. PlaywrightCaptureWorker 在隔离容器中根据当前 Release 固定的 approved ReleaseBriefVersion 探索产品；登录、验证码或敏感确认通过受审计的远程 handoff 交给用户。
3. Agent 将连续底层操作归纳为 3-8 个语义 FlowNodes；DiscoveryRun 启动时尚不存在 candidate version。
4. Worker 在同一固定镜像的干净 BrowserContext 中完成 clean replay；完成 DiscoveryRun 的事务校验候选 Flow、分配版本号、创建 draft ProductFlowVersion，并把 `proposed_version_id` 回填到 run。
5. 用户可重命名、排序、删除或重跑 draft，并确认每个节点证明的 Capability；批准 command 原子冻结该 candidate、更新 Release 引用并推进 stage。
6. Release 使用批准并固定的版本执行 CaptureRun；用户在 Evidence 页面逐项审阅结果，系统冻结 EvidencePackageVersion 后才能生成 Storyboard。

节点卡片默认只显示标题、Capability、结果缩略图和状态；点击后在 Inspector 中显示 Actions、Checkpoint、Evidence 和错误。底层每次 click 不单独占据画布节点。

### 2.2 数据关系

```text
Product
  -> ProductCapability
  -> ProductFlow
      -> ProductFlowVersion
          -> FlowNode
              -> BrowserAction[]
              -> Checkpoint
              -> proves ProductCapability[]

Release
  -> ProductFlowVersionRef
  -> CaptureRun
      -> NodeExecution[]
          -> NodeEvidence[]
              -> SourceAsset
  -> EvidencePackageVersion
      -> approved EvidenceRef[]
  -> Storyboard
      -> Scene references ProductCapability + EvidenceRef
```

### 2.3 核心合同

ProductFlow、Locator、BrowserAction、Assertion 与 FlowEdge 的规范 schema 见 Engineering Contracts 第 3 节。特别约束：Playwright locator handle、临时 DOM ref、坐标和 backend node id 不得持久化；批准前必须转换为结构化 Locator 并在固定 Worker 镜像中完成 clean replay。

### 2.4 运行与证据

Flow 定义与运行状态必须分离。节点本身不保存“正在运行”或“失败”，这些状态属于 NodeExecution。

NodeExecution、Evidence Manifest、运行幂等和断线恢复合同见 Engineering Contracts 第 2、3、4 节。

每个成功节点至少产生：结果截图、可用的视频片段、经清洗的 DOM 摘要和断言结果。可选产生前置截图、网络/控制台错误摘要和完整 trace。密码、Token、Cookie、输入值明文和跨域页面内容不得进入证据资产。

### 2.5 Browser Capture 边界

- 唯一运行单元是 Linux `PlaywrightCaptureWorker`，内部浏览器实现为 `PlaywrightBrowserAdapter`。每个 attempt 使用独立容器、独立 BrowserContext、固定 Playwright/Chromium 镜像 digest、只读根文件系统和临时 workspace；完成后销毁，不跨 Workspace 或 Product 复用 context。
- 云端凭据只以 workspace-scoped secret reference 持久化；worker 在运行时从 KMS/Vault 解密到内存或 tmpfs，不能把明文、Cookie、Token、storage state 或完整 Profile 写入 job payload、日志、Evidence 或 Composition。
- 允许访问的 origin 来自 Product 配置；Worker 在浏览器导航前执行 allowlist/SSRF 检查，首次 DNS 解析通过后将公开地址集合固定到当前 attempt，并由 egress proxy 只连接该集合。document 导航跳出 allowlist 会使当前 attempt 失败；越界的非 document 子资源会被阻断，但不会使已通过显式 checkpoint 的节点失败。
- 登录、验证码和敏感确认可以 handoff 给用户；Worker 依次调用同一签名 endpoint 的 `create/status/close`，暂停自动化并轮询状态，只有用户明确 Resume 后才继续同一个 BrowserContext。生产 job 必须提供 remote-control provider URL；缺失时稳定失败。支付、删除、发布、权限变更和其他外部副作用始终禁止，遇到时 Flow 候选不能批准。
- Worker 产生 Evidence 资产；Agent 只能创建 Flow 草稿，并建议 Evidence 的节点归属、摘要和选择，不能创建、修改或批准 ProductFlowVersion、NodeEvidence、SourceAsset、Storyboard 或 Artifact。
- DiscoveryRun 允许有界试错；正式 CaptureRun 只能确定性执行固定版本，不做开放式探索。
- `navigate` 只等待 `DOMContentLoaded`，节点就绪由 ProductFlow 的显式 checkpoint 判定；不能用 `networkidle` 代替业务 checkpoint。BrowserContext video、trace 和 action journal 是运行诊断源；每个成功节点仍必须生成独立 result screenshot、node clip、assertion report 和只含当前 viewport 可见元素的 sanitized DOM summary。
- Worker job、回调 fencing、远程 handoff、凭据生命周期和 Evidence 上传以 Engineering Contracts 第 4 节为准。

## 3. `product-launch-video` Skill 后端部署 Spec

### 3.1 定位

`product-launch-video` 是 PurpleInk 自有的版本化 orchestrator skill。它负责把已批准的产品证据导演为发布视频，但不负责登录、探索或操作客户产品。

本机当前没有该名称的现成 skill；实现时应新建独立 bundle，并复用已存在的 Hyperframes skills/CLI 规则。Skill 是 Agent 指令与工具合同，不是常驻 HTTP 服务；生产环境通过 `LaunchVideoRunner` 加载固定版本执行。

### 3.2 部署拓扑

```text
Next.js Control Plane
  -> PostgreSQL: versions, approvals, jobs, audit
  -> R2: evidence, bundles, previews, artifacts
  -> Trigger.dev workflow
      -> Linux Playwright Capture Worker
          -> one isolated container + BrowserContext per attempt
      -> LaunchVideo Runner
          -> product-launch-video@version
          -> Hyperframes CLI + Chrome + FFmpeg
```

Playwright Capture Worker 与 LaunchVideo Runner 是两个不同运行单元和权限边界。Capture Worker 可访问单个 CaptureSession 的产品 URL、短期凭据和受限外网；LaunchVideo Runner 不持有产品凭据、不接收用户产品 URL，物化批准资产后默认禁止外网访问。Capture 与 Render 不能复用容器、service account、网络策略或对象存储写入前缀。

### 3.3 Skill Bundle

```text
skills/product-launch-video/
  SKILL.md
  schemas/
    input-v1.schema.json
    launch-video-plan-v1.schema.json
  references/
    directing-rules.md
    linear-feature-launch.md
    hyperframes-contract.md
  scripts/
    validate-input.mjs
    validate-output.mjs

packages/video-compiler/
  schemas/
    composition-bundle-v1.schema.json
  templates/
    feature-launch/
  src/
    compile.ts
```

Skill、schema、prompt、template 与 Hyperframes 版本必须分别记录，不能只保存一个笼统的“Agent version”。Bundle 随容器镜像构建并以内容 hash 标识，运行时不可从网络更新。

### 3.4 输入合同

```ts
type LaunchVideoSkillInputV1 = {
  releaseId: string;
  releaseBriefVersionId: string;
  storyboardVersionId: string;
  productFlowVersionId: string;
  captureRunId: string;
  brandKitVersionId: string;
  evidencePackageVersionId: string;
  templateVersion: string;
  locale: string;
  targetDurationMs: number;
};
```

所有 ID 必须解析为同一 Workspace、Product 和 Release 下固定的已批准不可变版本。EvidencePackageVersion 使用 hash 锁定；Skill 不接受任意外部 URL 或 prompt 作为输入，只输出当前 locale 的 `LaunchVideoPlanV1`。画幅与质量属于 RenderJob 的 `requested_outputs`；locale、字幕文本和配音资产属于 Plan/Bundle 输入并进入 hash。

### 3.5 执行阶段

1. **Validate**：校验版本归属、审批状态、schema、hash、时长和画幅。
2. **Materialize**：通过短期签名 URL 下载资产到一次性 workspace，下载完成后撤销网络权限。
3. **Direct**：Skill 只生成 `LaunchVideoPlanV1`，每个 beat 引用一个 ProductCapability，并引用 Scene 与 Release 固定 EvidencePackageVersion 中的 EvidenceRef；禁止输出任意 HTML/CSS/JavaScript。
4. **Compose**：确定性 compiler 使用官方模板和 allowlisted Hyperframes components 生成 Composition Bundle。
5. **Quality Gate**：执行 `hyperframes lint`、`validate`、`inspect --json` 和抽帧非空白检查。
6. **Preview**：以 draft quality 生成 PreviewArtifact，等待用户审批。
7. **Final Render**：使用同一个 locale 的不可变 Composition Bundle 批量渲染 16:9 与 9:16；新语言必须创建新的 Plan 和 Bundle。
8. **Publish**：上传 Composition Bundle、QualityReport 和 Artifacts，写入 usage 与 audit events。

Preview 与 Final Render 之间禁止再次调用模型；只有用户修改 Storyboard、文案或视觉方向时才创建新的 Composition Bundle 版本。

### 3.6 Linear 风格导演约束

默认 Feature Launch 模板采用以下规则：

- 15-30 秒、3-5 个 beats，每个 beat 只证明一个 ProductCapability。
- 先展示结果或状态变化，再补足最少操作上下文。
- 光标和点击只在理解动作必需时出现，不制作完整教程。
- 将关键 UI 状态变化对齐音乐或动效节奏点，例如进度完成与状态切换同拍发生。
- 浏览器操作、状态变化和功能结果始终由 NodeEvidence 证明；approved SourceAsset 只支撑静态截图/录屏、Logo、品牌素材、字体和音频。允许缩放、裁切、遮罩和强调，不允许重画或修改产品事实。
- 文案短、构图克制、转场连续；品牌系统来自 BrandKit 与 PurpleInk `DESIGN.md`，不套用 Linear 的品牌资产。

### 3.7 任务可靠性与安全

- `render_key = hash(input versions + evidence hashes + skill + template + hyperframes + output config)`；成功结果可直接复用。Runner 另对 canonical skill input 计算 SHA-256 并持久化；retry 只能使用完全相同输入和 Release pins。
- 每个 job 使用 `job_id + attempt` fencing，旧 attempt 不能发布结果。
- Control Plane 通过 `POST /api/internal/launch-video/jobs` 签发绑定 workspace、job、attempt 与 expiry 的短期 token；Runner 只通过 `/execute` 执行，并通过 `/callback` 发布，两个 endpoint 都必须验证 path、body 与 token claims 完全一致。
- Preview 和 Final 分别设置 CPU、内存、磁盘、时长和重试上限；重试复用相同不可变输入。
- workspace 完成后销毁；日志不得包含用户输入值、Cookie、签名 URL 或源资产内容。
- Composition 只允许本地资产、固定依赖和 allowlisted components；禁止任意脚本下载及运行用户上传的 JavaScript。
- 所有失败必须归类为 `input_invalid`、`asset_missing`、`skill_failed`、`composition_invalid`、`render_failed` 或 `quality_failed`。
- LaunchVideoPlan、compiler、Bundle manifest 与 Runner API 以 Engineering Contracts 第 6 节为准。

### 3.8 MVP 验收

- 用户可从 Product 创建 Flow，通过 Linux Playwright Capture Worker 得到 3-8 个语义节点并批准版本；需要敏感登录时使用同一 cloud BrowserContext 的远程 handoff。
- Release 可固定一个 ProductFlowVersion，完成 CaptureRun 并逐节点审阅 Evidence。
- Storyboard 的每个事实 Scene 都能追溯到一个 ProductCapability 与 Release 固定 EvidencePackageVersion 中的 approved EvidenceRef；浏览器行为事实必须落到 NodeEvidence。
- `product-launch-video` 能生成 15-30 秒 Linear 气质的 16:9 draft preview。
- lint、validate、inspect、非空白抽帧全部通过后才允许审批终稿。
- 同一 Composition Bundle 可确定性渲染 16:9 与 9:16，历史 Artifact 不受新 Flow 版本影响。
- Golden Product 必须在生产 Linux Playwright 镜像中执行，不得使用 `MockBrowserAdapter`、fixture manifest 或上传素材替代采集；连续 20 次 clean replay 成功率至少 95%，相同输入重复编译得到相同 bundle hash。

## 4. 明确后置

- ProductFlow 分支、循环与条件表达式。
- 多人同时编辑节点图。
- 自动处理验证码、支付、删除、发布和权限变更。
- Skill 从网络动态安装或运行用户自定义 Skill。
- 自由时间线编辑器和任意 HTML/JavaScript 模板上传。
