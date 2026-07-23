# PurpleInk Engineering Contracts

> 状态：Accepted v3  
> 日期：2026-07-24  
> 适用范围：数据库、ProductFlow DSL、Playwright Capture Worker、Release 状态机、LaunchVideoRunner  
> 上游产品定义：[ProductFlow 与发布视频系统 Spec](./2026-07-23-product-flow-launch-video-system.md)

## 0. 文档优先级

工程实现发生冲突时按以下顺序裁决：

1. 本文的版本化合同和状态转换。
2. ProductFlow 与发布视频系统 Spec 的产品行为。
3. `CONTEXT.md` 的领域词义。
4. 旧 PRD 与 SaaS 架构中的未冲突部分。

第一条 MVP 纵向链路固定为：

```text
Product URL
  -> Linux Playwright DiscoveryRun
  -> approve ProductFlowVersion
  -> Linux Playwright CaptureRun
  -> approve NodeEvidence
  -> freeze EvidencePackageVersion
  -> Storyboard
  -> product-launch-video
  -> deterministic compiler
  -> Hyperframes preview
```

Linux Playwright Capture Worker 是 DiscoveryRun 与 CaptureRun 的唯一浏览器执行器，不存在 Ego、Local Bridge 或其他浏览器自动化回退。上传录屏可作为人工提供的 SourceAsset，但不能替代 Golden Product 浏览器链路或伪装为自动采集成功。正式 CaptureRun 使用固定版本 Flow 和固定 Worker image digest。

## 1. 全局工程规则

- 业务 ID 使用 UUID；时间使用 PostgreSQL `timestamptz`；API 时间使用 UTC ISO 8601。
- 所有租户业务表显式包含 `workspace_id`，跨表引用使用 `(workspace_id, id)` 复合外键；所有 Repository 和服务方法从 session/job context 注入 workspace scope，禁止仅按 `id` 查询。
- 所有 mutation 接受 `idempotency_key`；编辑聚合根时同时接受 `expected_revision`。
- 已批准版本不可更新或删除，只能创建后继版本；可变状态、运行状态和审批状态不得写入不可变 payload。
- 版本化文档使用 Zod 与 JSON Schema 双重校验，保存 `schema_version` 与 `content_hash`。
- PostgreSQL 保存归属、状态、索引和版本关系；大文件进入 R2；不可变复杂文档保存为受 schema 约束的 JSONB。
- Agent 只能提交候选文档；领域服务负责校验、持久化、批准和状态转换。

## 2. 持久化合同

### 2.1 核心表

| 表 | 必需字段 | 关键约束 |
| --- | --- | --- |
| `products` | `id, workspace_id, name, canonical_url, status, revision, archived_at` | `canonical_url` 为 HTTPS；归档不删除历史版本 |
| `brand_kits` | `id, workspace_id, product_id` | 一个 Product 一个 BrandKit 聚合根 |
| `brand_kit_versions` | `id, workspace_id, brand_kit_id, version, payload, content_hash, status` | `unique(workspace_id, brand_kit_id, version)`；approved 不可变 |
| `product_capabilities` | `id, workspace_id, product_id, name, description, status` | 名称在未归档 capability 中唯一 |
| `product_flows` | `id, workspace_id, product_id, name, revision, archived_at` | 只属于一个 Product |
| `product_flow_versions` | `id, workspace_id, product_flow_id, version, payload, content_hash, status, approved_at` | `unique(workspace_id, product_flow_id, version)`；approved 不可变 |
| `releases` | `id, workspace_id, product_id, lifecycle, stage, failed_from_stage, revision` | selected version 必须属于同一 Product |
| `release_brief_versions` | `id, workspace_id, release_id, version, payload, content_hash, status` | approved 不可变 |
| `browser_profiles` | `id, workspace_id, product_id, encrypted_state_ref, status, revision` | Playwright storage state 只保存 KMS envelope-encrypted reference；明文不可进入数据库或 job payload |
| `capture_sessions` | `id, workspace_id, product_id, release_id?, browser_profile_id?, kind, state, expires_at, last_event_seq` | 只由 PlaywrightCaptureWorker 执行；active 并发由对应 DiscoveryRun/CaptureRun 约束 |
| `capture_worker_jobs` | `id, workspace_id, capture_session_id, attempt, browser_profile_id?, browser_profile_revision?, image_digest, region, status, lease_expires_at` | `unique(workspace_id, capture_session_id, attempt)`；profile revision 启动后冻结；旧 attempt 不能完成 session 或发布 Evidence |
| `discovery_runs` | `id, workspace_id, release_id, release_brief_version_id, product_flow_id, capture_session_id, status, proposed_version_id` | MVP 必须追溯到 approved ReleaseBriefVersion；每个 ProductFlow 最多一个 active run |
| `capture_runs` | `id, workspace_id, release_id, flow_version_id, capture_session_id, status, started_at, finished_at` | 每个 Release 同时最多一个 active run |
| `node_executions` | `id, workspace_id, capture_run_id, node_id, status, started_at, finished_at, error_code` | `unique(workspace_id, capture_run_id, node_id)` |
| `source_assets` | `id, workspace_id, product_id, kind` | 只保存归属，不保存二进制 |
| `asset_versions` | `id, workspace_id, source_asset_id, r2_key, sha256, bytes, mime_type, metadata` | `unique(workspace_id, source_asset_id, sha256)` |
| `node_evidence` | `id, workspace_id, node_execution_id, kind, asset_version_id, manifest, approved_at` | 必须追溯到一个 NodeExecution；只引用 redaction `passed` 的 AssetVersion |
| `evidence_packages` | `id, workspace_id, release_id` | 一个 Release 一个 EvidencePackage 聚合根 |
| `evidence_package_versions` | `id, workspace_id, evidence_package_id, version, capture_run_id, payload, content_hash, status` | approved 不可变；冻结本次批准的 EvidenceRef 集合与 provenance |
| `storyboards` | `id, workspace_id, release_id` | 一个 Release 一个聚合根 |
| `storyboard_versions` | `id, workspace_id, storyboard_id, version, payload, content_hash, status` | approved 不可变 |
| `approvals` | `id, workspace_id, release_id, subject_type, subject_id, decision, actor_id, created_at` | 每次决定追加记录，不覆盖历史 |
| `composition_bundles` | `id, workspace_id, release_id, storyboard_version_id, evidence_package_version_id, brand_kit_version_id, locale, plan_hash, bundle_hash, r2_key, status` | 每个 locale 独立 Bundle；输入 hash 相同则复用 |
| `render_jobs` | `id, workspace_id, release_id, bundle_id, kind, status, render_key, requested_outputs` | 只能选择 Bundle 已包含的 variant 与质量档；成功 `render_key` 唯一 |
| `render_attempts` | `id, workspace_id, render_job_id, attempt, status, error_code, started_at, finished_at` | `unique(workspace_id, render_job_id, attempt)` |
| `artifacts` | `id, workspace_id, render_job_id, attempt_id, kind, r2_key, sha256, metadata, published_at` | 只有当前成功 attempt 可发布 |
| `audit_events` | `id, workspace_id, actor_type, actor_id, event_type, subject_type, subject_id, payload, created_at` | append-only |

### 2.2 Release 固定引用

`releases` 保存当前已选择的引用：

```ts
type ReleaseRefsV1 = {
  briefVersionId?: string;
  productFlowVersionId?: string;
  captureRunId?: string;
  evidencePackageVersionId?: string;
  storyboardVersionId?: string;
  brandKitVersionId?: string;
  previewBundleId?: string;
};
```

写入引用时，领域服务必须在同一事务中检查 workspace、product、release、审批状态和版本状态。不能只依赖前端隐藏按钮。

### 2.3 下游失效

创建后继版本不会影响任何已固定旧版本的 Release。只有用户通过带 `expected_revision` 与 `idempotency_key` 的 `repin_*` command 显式切换当前 Release 引用时，系统才在同一事务中更新 ReleaseRefs、将相关下游记录为 `stale` 并返回对应阶段：

| 改动 | 失效对象 | Release 返回阶段 |
| --- | --- | --- |
| ReleaseBrief 的目标或 Capability | Flow selection、Evidence、Storyboard、Bundle | `flow_selecting` |
| ProductFlowVersion | CaptureRun、Evidence、Storyboard、Bundle | `capture_pending` |
| NodeEvidence 审批 | Storyboard、Bundle | `evidence_review` |
| StoryboardVersion | CompositionBundle、RenderJob | `storyboard_review` |
| BrandKitVersion | CompositionBundle、RenderJob | `preview_queued` |

历史 Release 和 Artifact 保持原引用与可访问性，不随 Product 下出现新版本或其他 Release 的 repin 改变。

## 3. ProductFlow DSL V1

### 3.1 持久化 Locator

禁止把 Playwright locator handle、临时 DOM ref、坐标或临时 backend node id 写入 ProductFlowVersion。持久化 locator 必须是结构化、可重新解析的语义定位器：

```ts
type LocatorV1 = {
  by: "test_id" | "role" | "label" | "placeholder" | "href" | "text" | "css";
  value: string;
  role?: string;
  exact?: boolean;
  scope?: LocatorV1;
  frame?: LocatorV1;
};
```

执行器按 `test_id -> href -> role/label -> placeholder -> text -> css` 的优先级生成候选。DiscoveryRun 可以使用 Playwright 临时 locator、DOM ref 和坐标探索，但批准 Flow 前必须转换为 LocatorV1，并在与生产相同 image digest 的干净 BrowserContext 中通过一次 clean replay。

### 3.2 Flow 文档

```ts
type ProductFlowVersionV1 = {
  schemaVersion: "product-flow/v1";
  productId: string;
  startUrl: string;
  allowedOrigins: string[];
  viewport: { width: number; height: number; deviceScaleFactor: number };
  locale: string;
  timezone: string;
  nodes: FlowNodeV1[];
  edges: FlowEdgeV1[];
};

type FlowNodeV1 = {
  id: string;
  order: number;
  title: string;
  intent: string;
  capabilityIds: string[];
  actions: BrowserActionV1[];
  checkpoints: AssertionV1[];
};

type BrowserActionV1 = {
  id: string;
  kind: "navigate" | "click" | "fill" | "select" | "keypress" | "upload" | "wait_for";
  target?: LocatorV1;
  value?: ValueSourceV1;
  expectedUrl?: string;
  timeoutMs: number;
  effect: "read" | "idempotent_write" | "non_idempotent_write" | "external_side_effect";
};

type ValueSourceV1 =
  | { kind: "literal"; value: string }
  | { kind: "fixture"; key: string }
  | { kind: "local_secret"; key: string }
  | { kind: "user_handoff"; prompt: string };

type AssertionV1 = {
  id: string;
  kind: "visible" | "hidden" | "text_contains" | "value_equals" | "count_equals" | "url_matches";
  target?: LocatorV1;
  expected?: string | number;
  timeoutMs: number;
};

type FlowEdgeV1 = { from: string; to: string };
```

### 3.3 执行规则

- MVP Flow 必须线性、无环、3-8 个节点、最多 100 个 actions。
- `external_side_effect` 禁止进入批准版本。Handoff 只允许登录、验证码和敏感确认；支付、发布、删除、权限变更及其他外部副作用即使由用户接管也不属于可批准 Flow，遇到时必须取消或失败该候选。
- `non_idempotent_write` 必须提供可验证 checkpoint 与测试数据 reset 说明，否则不能批准。
- 正式 CaptureRun 每个 action 最多自动重试一次；非幂等 action 不自动重试。
- Worker 以 action journal 记录 `node_id, action_id, attempt, started_at, finished_at, postcondition`。BrowserContext 或容器丢失即结束当前 attempt；新 attempt 只能从持久化登录态和可证明安全的 checkpoint 重建。若无法证明非幂等 action 的 postcondition，必须进入 `awaiting_user` 或失败，不得声称恢复原 BrowserContext，也不得盲目重复点击。
- 成功节点至少输出 result screenshot、node clip、assertion report 和 sanitized DOM summary。

## 4. Playwright Capture Worker Protocol V2

### 4.1 执行器与隔离

- Playwright Capture Worker 是唯一浏览器执行器。每个 attempt 启动一个 Linux 容器和一个 BrowserContext；容器固定 Playwright/Chromium image digest，以非 root 用户运行，根文件系统只读，仅开放 tmpfs workspace。
- Capture Worker 只能读取一个 workspace、一个 CaptureSession、一个 approved ProductFlowVersion 和该 session 的 secret references；不能读取 Storyboard、Composition 或其他 Product 的浏览器状态。
- Capture Worker 通过受限 egress proxy 访问 `allowedOrigins`。导航前校验 URL，DNS 解析后再次拒绝 loopback、link-local、RFC1918、ULA、cloud metadata 和 DNS rebinding。
- Worker 容器设置 CPU、内存、磁盘、进程数和运行时限；同一容器、BrowserContext、临时目录、service account 或 R2 写前缀不得跨 attempt 复用。
- 部署配置必须给出资源默认值、硬上限和稳定的超限错误码；具体云厂商实例规格不进入领域合同。

### 4.2 凭据与 Browser Profile

- 用户可以在受控 setup session 中登录云端 BrowserContext。持久化 storage state 必须使用 workspace-scoped KMS envelope encryption，并保存为不可猜测的 `encrypted_state_ref`；每次变更创建新的 BrowserProfile revision。
- 数据库、工作流 payload、CaptureSession、事件、日志和 trace 不得包含密码、Cookie、Token、localStorage 明文或完整 Browser Profile。
- Worker 启动时以短期 workload identity 获取密文，在内存或 tmpfs 解密；attempt 结束立即销毁明文和临时 Profile。
- `ValueSourceV1.local_secret` 解析为 Vault secret reference；值只注入对应 fill action，不返回 Agent，不写入 DOM summary、trace annotation 或 assertion report。
- BrowserProfile 跨 Product 禁止复用；跨 Workspace 访问一律返回 not found 并记录安全审计事件。
- Capture job 在创建时固定 `browser_profile_id + revision`，attempt 运行中不得更新。Handoff 产生的新登录态只能创建新 revision，并从后续 attempt 开始使用。

### 4.3 CaptureSession 状态

```text
created -> claimed -> running -> uploading -> completed
                    -> awaiting_user -> running
                    -> failed | cancelled | expired
```

- Session 默认 TTL 30 分钟，heartbeat 可续期但总时长不超过 60 分钟。
- Worker 每 10 秒 heartbeat；30 秒无 heartbeat 将独立 `connectivity` 标记为 `disconnected`，Session state 保持原值且不立即重复 action。
- CaptureSession 通过 `capture_session_id + attempt` 原子 lease；同一 attempt 重复领取返回同一 job，不创建第二个 run。每个 Release 最多一个 active CaptureRun，每个 ProductFlow 最多一个 active DiscoveryRun；不同 Release 可以并行。
- Event 带单调递增 `seq`；服务端以 `(session_id, seq)` 幂等去重。
- `awaiting_user` 时自动化输入必须停止。用户通过一次性、短期 remote-control URL 接管同一个 cloud BrowserContext；只有显式 Resume 事件才能恢复，系统不得自动接管。

### 4.4 Capture Worker API

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/api/internal/capture/jobs` | 工作流创建带 image digest 和 attempt fencing 的 Worker job |
| `POST` | `/api/internal/capture/jobs/:id/lease` | Worker 原子领取指定 attempt |
| `POST` | `/api/internal/capture/jobs/:id/heartbeat` | 上报 session、node、action、connectivity 与 lease |
| `POST` | `/api/internal/capture/jobs/:id/events` | 批量追加有序 action/assertion 事件 |
| `POST` | `/api/internal/capture/jobs/:id/handoff` | 创建或关闭短期 remote-control handoff |
| `POST` | `/api/internal/capture/jobs/:id/uploads/sign` | 为 attempt 隔离的 Evidence 条目签名 |
| `POST` | `/api/internal/capture/jobs/:id/callback` | 提交完成 manifest 或稳定失败代码 |

Worker endpoint 使用 workload identity、任务级签名、`job_id + attempt` fencing 和短期 lease。旧 attempt 可以写入隔离 R2 prefix，但不能更新 CaptureSession、Evidence published pointer 或 Release。

所有 endpoint 校验 workload identity、worker、workspace、session、job、attempt 与 expiry。上传 URL 绑定 attempt 隔离的固定 R2 key、MIME、最大字节数和 SHA-256，不允许通用 bucket 写权限。

### 4.5 Evidence Manifest

```ts
type EvidenceManifestV1 = {
  schemaVersion: "evidence-manifest/v1";
  workspaceId: string;
  captureSessionId: string;
  jobId: string;
  attempt: number;
  runId: string;
  flowVersionId: string;
  imageDigest: string;
  actionJournalHash: string;
  entries: Array<{
    nodeId: string;
    actionId?: string;
    kind: "before_screenshot" | "result_screenshot" | "node_clip" | "assertion_report" | "dom_summary" | "trace" | "diagnostic";
    r2Key: string;
    mimeType: string;
    bytes: number;
    sha256: string;
    redactionStatus: "passed" | "blocked" | "needs_review";
  }>;
};
```

只有 manifest 全部对象 hash、大小、归属和 provenance 验证通过，且所有候选 Evidence 条目 redaction 为 `passed` 后，CaptureRun 才能进入 evidence review。

`blocked` 与 `needs_review` 对象只能写入当前 attempt 的 quarantine prefix，不能创建候选 NodeEvidence 或进入 EvidencePackageVersion。人工处理必须生成新的 AssetVersion，重新扫描并得到 `passed`；原对象和 hash 永不原地改写。

### 4.6 Evidence 生成、Handoff 与安全

- 每个 node 完成 checkpoint 后使用 `page.screenshot` 生成 result screenshot；BrowserContext 全程录制 video，按 action journal 时间戳用固定 FFmpeg 版本切出 node clip。
- Assertion executor 输出结构化 assertion report；DOM sanitizer 只保留 allowlisted tag、role、accessible name、稳定属性和文本摘要，移除表单值、脚本、样式、Cookie、Token 与跨域内容。
- Playwright trace 是诊断资产，不自动成为 approved Evidence；trace 必须清洗网络 headers、请求体、响应体和输入值。
- Worker 遇到登录、验证码、敏感确认或 origin 跳转时发出 `user_action_required` 并停止自动化。Agent 只有在用户从 handoff UI 明确 Resume 后才能恢复，禁止定时或自动 takeover。
- 下载、扩展安装、权限弹窗、支付、发布、删除和权限变更默认拒绝；`external_side_effect` 永远不能由 Playwright Worker 执行。
- manifest 验证必须确认全部对象位于当前 workspace/session/attempt prefix，且对象 hash、大小、MIME、redaction 和 node/action provenance 一致。

### 4.7 Evidence Package

```ts
type EvidenceRefV1 =
  | { kind: "node_evidence"; nodeEvidenceId: string; assetVersionId: string }
  | { kind: "source_asset"; sourceAssetId: string; assetVersionId: string };

type EvidencePackageVersionV1 = {
  schemaVersion: "evidence-package/v1";
  releaseId: string;
  captureRunId: string;
  refs: EvidenceRefV1[];
  provenance: {
    flowVersionId: string;
    manifestHash: string;
    workerImageDigest: string;
  };
};
```

浏览器操作、状态变化和功能结果只能由 approved NodeEvidence 证明。Approved SourceAsset 只允许支撑 Logo、品牌素材、用户提供的静态截图或录屏、字体和音频；它不能替代 CaptureRun、不能满足行为 checkpoint，也不能让 Golden E2E 通过。

用户先逐项批准或拒绝 NodeEvidence/SourceAsset；最终 `approve_evidence` 在一个事务中验证全部决定、冻结 EvidencePackageVersion、更新 ReleaseRefs 并推进 stage。Worker 产生 Evidence 资产；Agent 只能建议节点归属、摘要和选择，不能创建、修改或批准 Evidence。

## 5. Release 状态合同

Release 使用两个正交字段，避免失败后丢失原阶段：

```ts
type ReleaseLifecycle = "active" | "failed" | "cancelled" | "delivered";
type ReleaseStage =
  | "brief_draft"
  | "flow_selecting"
  | "flow_discovering"
  | "flow_review"
  | "capture_pending"
  | "capturing"
  | "evidence_review"
  | "storyboard_generating"
  | "storyboard_review"
  | "preview_queued"
  | "preview_rendering"
  | "preview_review"
  | "final_queued"
  | "final_rendering"
  | "complete";
```

### 5.1 Transition table

| Command/Event | From | Guard | To |
| --- | --- | --- | --- |
| `approve_brief` | `brief_draft` | candidate ReleaseBriefVersion valid | `flow_selecting` |
| `start_discovery` | `flow_selecting` | approved Brief pinned、Product URL valid、fenced Worker job ready | `flow_discovering` |
| `discovery_completed` | `flow_discovering` | draft schema valid、clean replay passed | `flow_review` |
| `approve_flow` | `flow_review` | draft ProductFlowVersion valid | `capture_pending` |
| `select_flow_version` | `flow_selecting` | existing approved ProductFlowVersion | `capture_pending` |
| `start_capture` | `capture_pending` | approved Flow、fenced Worker job ready、no active run | `capturing` |
| `capture_completed` | `capturing` | manifest verified | `evidence_review` |
| `approve_evidence` | `evidence_review` | item decisions complete、EvidencePackage candidate valid | `storyboard_generating` |
| `storyboard_generated` | `storyboard_generating` | schema and provenance valid | `storyboard_review` |
| `approve_storyboard` | `storyboard_review` | candidate StoryboardVersion valid | `preview_queued` |
| `preview_started` | `preview_queued` | fenced RenderAttempt | `preview_rendering` |
| `preview_completed` | `preview_rendering` | quality gates passed | `preview_review` |
| `revise_storyboard` | `preview_review` | copy/fact/evidence feedback recorded | `storyboard_review` |
| `revise_visual_plan` | `preview_review` | visual feedback recorded、Storyboard remains valid | `preview_queued` |
| `approve_preview` | `preview_review` | current Bundle quality passed、preview candidate valid | `final_queued` |
| `final_started` | `final_queued` | required outputs frozen | `final_rendering` |
| `final_completed` | `final_rendering` | all required outputs published | `complete`, lifecycle `delivered` |

任何运行事件失败时设置 lifecycle=`failed` 和 `failed_from_stage=current stage`。`retry` 只能恢复到 `failed_from_stage`，并创建新 attempt；取消设置 lifecycle=`cancelled`，不删除已经产生的版本和资产。

在 `flow_review`、`evidence_review` 或 `storyboard_review` 拒绝候选时，stage 保持不变并创建新的 draft/version/attempt；不能修改被拒绝或已批准的历史版本。

所有 command 在领域服务内以 `expected_revision` 和事务执行。重复 command 使用 `idempotency_key` 返回首次结果。`approve_brief`、`approve_flow`、`approve_evidence` 与 `approve_storyboard` 都接收 candidate，并在同一事务内完成校验、追加 Approval、冻结版本或 Package、更新 ReleaseRefs 和推进 stage；guard 不得要求 candidate 预先 approved。

领域 command 使用 `idempotency_key`；Worker event 使用 `(session_id, seq)`；completion callback 使用 `(job_id, attempt)`；heartbeat 以当前 lease 为边界执行幂等覆盖。禁止为了表面统一而让所有协议共用一种幂等键。

## 6. LaunchVideoPlan 与 Compiler 合同

### 6.1 责任边界

```text
product-launch-video skill
  -> LaunchVideoPlanV1 JSON
  -> schema + provenance validation
  -> deterministic compiler
  -> immutable CompositionBundleV1
  -> Hyperframes render
  -> Artifact + QualityReport
```

Agent/Skill 禁止输出或执行 HTML、CSS、JavaScript、shell、npm dependency 或外部 URL。它只能从版本化 TemplateCapabilities 中选择 layout、motion、transition 和公开参数。

### 6.2 Plan schema

```ts
type LaunchVideoPlanV1 = {
  schemaVersion: "launch-video-plan/v1";
  releaseId: string;
  storyboardVersionId: string;
  evidencePackageVersionId: string;
  brandKitVersionId: string;
  templateVersion: string;
  locale: string;
  durationMs: number;
  beats: LaunchBeatV1[];
  subtitles?: Array<{ startMs: number; endMs: number; text: string }>;
  audio?: { narrationAssetVersionId?: string; musicAssetVersionId?: string };
};

type LaunchBeatV1 = {
  id: string;
  sceneId: string;
  capabilityId: string;
  startMs: number;
  durationMs: number;
  layoutId: string;
  motionPresetId: string;
  transitionId: string;
  headline?: string;
  body?: string;
  evidence: Array<EvidenceRefV1 & {
    trim?: { inMs: number; outMs: number };
    crop?: { x: number; y: number; width: number; height: number };
    focus?: { x: number; y: number; width: number; height: number };
  }>;
};
```

校验要求：3-5 beats；总时长 15-30 秒；时间无重叠或空洞；每个 beat 引用当前 Storyboard Scene 且只证明一个 ProductCapability；浏览器行为事实至少引用一个 approved NodeEvidence，静态素材可以引用 approved SourceAsset；所有引用必须来自 Release 固定的 EvidencePackageVersion；文案与字幕满足模板字数限制；所有 ID 同租户同 Release。

### 6.3 Compiler 与 Bundle

Compiler 是纯函数：

```text
LaunchVideoPlanV1
+ BrandKitVersionV1
+ EvidencePackageVersionV1
+ TemplateVersion
+ immutable AssetPackage
+ OutputVariantSpecV1[]
+ compilerVersion
= CompositionBundleV1
```

```ts
type OutputVariantSpecV1 = {
  id: "landscape" | "portrait";
  width: 1920 | 1080;
  height: 1080 | 1920;
  fps: 30 | 60;
};
```

每个 locale 生成独立 LaunchVideoPlan 和 CompositionBundle；locale、字幕文本和配音资产进入 Plan/Bundle hash。MVP 在 preview 前为该 locale 固定 `landscape` 与 `portrait` 两个 variants；Preview 只渲染 landscape，Final Render 可渲染两者。RenderJob 只能选择 Bundle 已包含的 variant 与质量档，不得在渲染时注入另一种语言。`CompositionBundleV1` 包含每个 variant 的独立 root composition，manifest 至少保存 locale、所有输入 hash、compiler/Hyperframes 版本、生成文件 hash、variants、fps、时长和 asset map。相同输入必须得到相同 bundle hash。

Preview 与 Final Render 都只消费 CompositionBundle；两者之间不调用 Agent。Storyboard、BrandKit 或视觉反馈改变时创建新 Plan 和 Bundle，不修改旧 Bundle。

### 6.4 Runner API

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/api/internal/launch-video/jobs` | 工作流创建 fenced job |
| `POST` | `/api/internal/launch-video/jobs/:id/callback` | attempt 状态与输出 manifest |
| `GET` | `/api/jobs/:id/events?cursor=` | Web SSE/轮询读取进度 |

内部接口使用任务级签名、`job_id + attempt` fencing 和 idempotency key。旧 attempt 可以上传隔离对象，但不能更新 bundle/artifact 的 published pointer。

## 7. MVP 限制与验收

### 7.1 固定限制

- 首批只支持 Linux x86_64 `PlaywrightCaptureWorker`、Web SaaS、HTTPS URL 和单一浏览器标签页主流程；其内部浏览器实现统一命名为 `PlaywrightBrowserAdapter`。ProductFlow DSL 保持浏览器语义化，但不暴露 executor/provider 字段，也没有第二浏览器执行器或本地回退。
- Worker 镜像固定 Playwright、Chromium、FFmpeg/FFprobe 与字体版本，并以 immutable digest 写入 CaptureRun provenance。
- Flow 3-8 nodes、最多 100 actions；CaptureSession 默认 30 分钟、最大 60 分钟。
- 每个 Release 首个模板为 Feature Launch；输出 16:9 preview，终稿支持 16:9 与 9:16。
- 多分支 Flow、多人实时编辑、长期托管通用浏览器 Profile、任意用户模板和自由时间线后置；短期 setup session 与同一 BrowserContext handoff 属于 MVP。

### 7.2 工程验收

- Golden Product 使用独立部署、可重置的测试环境和唯一测试数据，在生产 Linux Worker 镜像中连续 20 次 clean replay 成功率至少 95%，失败能定位到 container/session/node/action/assertion/error code；不得使用 `MockBrowserAdapter`、开发机页面、fixture manifest 或上传素材替代浏览器采集。
- 100% 事实 Scene 可追溯到 approved NodeEvidence 或 approved uploaded SourceAsset。
- Worker 断线后不会重复非幂等 action；同一 Session 重复事件和完成请求不产生重复资产。
- 跨 workspace ID、跨 Product BrowserProfile、过期 workload token、伪造 manifest、私网/metadata URL、DNS rebinding 与旧 attempt callback 自动化测试必须 100% 拒绝；这些安全断言不计入允许一次失败的 95% replay 指标。
- Handoff URL 一次性且短期有效；关闭 handoff 或 session 后不能重新连接。排除人工登录等待，首个可审阅 preview 在 30 分钟内生成。
- result screenshot、node clip、assertion report 和 sanitized DOM summary 均由真实 Playwright run 生成并通过 R2 HEAD/hash 验证；不能用 fixture 或 mock manifest 通过生产验收。
- PR gate 使用隔离的 S3/R2-compatible store 验证上传合同；scheduled/release gate 必须使用真实 Cloudflare R2 staging bucket 验证签名、HEAD、metadata 和 checksum 行为。
- 每个 run 的日志、指标和审计事件必须关联 `workspace_id, release_id, capture_session_id, job_id, attempt, node_id, action_id`；安全拒绝、lease 丢失、handoff 和 redaction 分别计数并告警。
- Hyperframes lint、validate、inspect、媒体探测、非空白抽帧和证据引用检查全部通过才可进入 preview review。
- 相同输入重复编译得到相同 bundle hash；相同 render key 的成功 Artifact 可复用。

## 8. 实施顺序

1. Auth、Workspace、Product、Release 与版本表。
2. ProductFlow DSL schema、节点图编辑器与领域校验。
3. CaptureSession、Worker job/lease、BrowserProfile secret reference 与 Evidence upload 合同。
4. Linux PlaywrightCaptureWorker happy path、真实 Evidence、clean replay、handoff 和失败恢复。
5. EvidencePackageVersion、Storyboard schema、按 locale 的 LaunchVideoPlanV1 与 deterministic compiler。
6. Hyperframes preview、审批、final render 与 Artifact 发布。
7. Playwright 失败恢复、安全负面测试、可观测性和运营面板。
8. 删除 Ego package、Bridge routes、device schema、相关环境变量与测试；不得保留 runtime feature flag 或 fallback。Playwright gate 未通过前只能停用 Capture，不能切回旧执行器。
