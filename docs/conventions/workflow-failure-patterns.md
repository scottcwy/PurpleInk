# 工作流失败模式手册

本文件是 Director / 渲染 / 音频 / 模型路由这条链路上**已经真实发生过**的失败模式清单。
每条模式都来自一次线上事故，包含症状、真实病因、必须做的检查与已落地的护栏。

适用范围：改动 `src/features/director`、`src/features/audio`、`src/features/render`、
`src/features/ai`、`src/features/canvas/workflow-error.ts` 或任何阶段合同前，先读本文。
新发现的复发型失败请**追加为新模式**，不要另开文件，也不要把结论散落进 issue 记录。

本文件不替代 `docs/conventions/routing.md`（路由真值）与 `docs/designs/*`（视觉真值），
只负责「同一类错误不要再犯第二次」。

---

## 1. 诊断顺序：先拿服务端真值，再谈现象

UI 弹窗里的文案是**脱敏投影**，不是原始报文。按这个顺序取证，实测每一步都必要：

| 步骤 | 位置 | 能回答什么 |
| --- | --- | --- |
| 1 | `canvas_nodes.status` + `data.payload.directorError` | 哪个节点失败、给用户看到了什么类别 |
| 2 | `task_attempts.failure.message` | **原始报文在这里**，包括 zod issue 全文 |
| 3 | attempt 的 `started_at` → `completed_at` | 几十毫秒 = 根本没调模型，问题在应用内 |
| 4 | `artifacts` 表与 `.data/artifacts/<domain>/<projectId>/<nodeId>/` | 哪一阶段真的写出了产物，链路断在哪一环 |
| 5 | `model_routes` / `media_routes` | 文本与媒体路由的真值（provider + model） |
| 6 | dev server 窗口 / `.next/dev/logs` | 是否根本没加载到新代码（见模式 F） |

本地取证模板（Windows PowerShell，容器名以 `docker ps` 为准）：

```powershell
docker exec purpleink-dev-postgres-1 psql -U cvc -d cvc -A -F " | " -c `
  "select project_id, logical_key, stage, status, updated_at from canvas_nodes where status='failed' order by updated_at desc limit 10"

docker exec purpleink-dev-postgres-1 psql -U cvc -d cvc -c `
  "select left(failure->>'message',600) as err, checkpoint->'payload'->>'stage' as stage, created_at from task_attempts where status='failed' order by created_at desc limit 5"

docker exec purpleink-dev-postgres-1 psql -U cvc -d cvc -A -F " | " -c `
  "select ai_task_kind, provider, model from model_routes"
docker exec purpleink-dev-postgres-1 psql -U cvc -d cvc -A -F " | " -c `
  "select media_task_kind, provider, model from media_routes"
```

判定「是否真的调过模型」优先看 attempt 时长与阶段产物，不要只看 `ai_invocations`
（legacy director 路径不写这张表，空表不等于没调用）。

---

## 2. 模式 A：同一契约的平行窄定义

**症状**：某个阶段 100% 失败，报文是 `unrecognized_keys` / `invalid_type`，而上游阶段产物看起来完全正常。

**真实事故**：`prompts/shot-spec.ts` 把 `target.sourceUnit` 重写成只允许
`{ unitId, text }` 的 `.strict()` 对象，而 INGEST 提示词明确要求模型输出 `order`，
SSOT 的 `scriptUnitSchema` 还允许 `speaker`。于是 SHOT_SPEC 在 `buildPrompt` 阶段
抛错，一次模型都没调（attempt 55ms 内失败），撰写分镜脚本永久失败。

**规则**：

- 跨阶段流动的数据结构只能有一个 zod 定义。script unit 的真值是
  `src/features/director/schemas/ingest.ts`；shot plan 的运行时真值是
  `schemas/director-shot-plan.ts`（`passthrough`），严格门禁真值是 `schemas/shot-plan.ts`。
- 任何 prompt 输入 schema 里**不得内联重写**已有契约的子结构，必须 import 复用。
- `.strict()` 只允许出现在「这一层的键集合由我定义」的地方；上游原样流入的对象一律复用上游 schema。

**已落地护栏**：`src/features/director/prompts/prompts.test.ts` 的
「INGEST script unit 合同跨阶段流通」——一个填满所有可选字段的 script unit 必须能流入
INGEST / DIRECT / SHOT_SPEC / ASSEMBLE·shot-sfx / ASSEMBLE·shot-subtitle 的输入合同。
新增消费方时必须把它加进那张表。

---

## 3. 模式 B：内部错误被贴上外部标签

**症状**：弹窗说「镜头渲染或媒体处理失败」或「外部生成服务本次执行失败」，并给出重试按钮；
用户重试 N 次，每次都在同一秒失败。

**真实事故（两起）**：

1. SHOT_SPEC 的 zod 合同错误未命中任何文案规则，落进最后的 `RENDER_FAILED` 兜底——
   阶段指错、原因指错，还劝用户重试。
2. `shot-sfx 是媒体节点，不能解析为 Director 模型` 这条**内部路由矛盾**因为含「模型」二字，
   命中 `/provider|模型|网络|timeout|超时|ASR|TTS/` 规则，被归成 `PROVIDER_FAILED`
   且 `retryable=true`。

**规则**：

- `classifyWorkflowError` 的判定顺序是 `classifyByType` → `classifyByMessage` → `classifyByStage`。
  **类型永远优先于文案**：zod 报文天然含 `required` / `invalid`，靠关键词匹配必然误判。
- 新增错误来源时先问：这是外部原因还是应用内部矛盾？内部矛盾必须 `retryable=false`，
  否则 `StageErrorDialog` 会展示重试按钮，`recovery` 也会反复重排同一个必败作业。
- 兜底类别必须按阶段职责给：`RENDER_FAILED` 只属于 `RENDER`，`MEDIA_FAILED` 只属于
  `MEDIA_NARRATION`，文本阶段用 `STAGE_FAILED` 且文案带阶段名。禁止再出现「所有未识别错误都自称渲染失败」。
- 文案可以点名**我们自己合同的字段路径**（如 `target.sourceUnit.order`），
  不得回显字段取值、原稿、prompt、凭据或 provider 原始响应。

**已落地护栏**：`src/features/canvas/workflow-error.test.ts` 覆盖
「非渲染阶段不得称渲染失败」「schema 失败必须点名字段且不可重试」「各阶段兜底归位」。
内部路由/能力矛盾另有 `RouteContractError`（`src/features/ai/route-contract-error.ts`），
`classifyByType` 按类型识别为 `ROUTE_CONTRACT_INVALID` 且 `retryable=false`，
断言见同一测试文件「路由/能力矛盾归类为不可重试的配置问题」。

---

## 4. 模式 C：节点类型 × 阶段矩阵没有全覆盖

**症状**：某一类泳道节点全线失败，其他阶段完全正常；全套测试却是绿的。

**真实事故**：`feat(ai): 建立能力感知的供应商注册表` 在 `resolveDirectorModelTarget`
开头加了「媒体域节点直接抛错」。但 `shot-sfx` / `shot-subtitle` 这两个节点**同时**需要
一个文本模型（LLM 产出音效清单 / 字幕规划，历史上有 77 个节点成功并留下 `director-assemble` 产物）
和一条媒体路由（TTS / ASR）。改动把「媒体域 → 回落默认文本模型」变成了硬抛，
两个职责被当成一个，音效与字幕通道全线失败。测试全绿是因为没有任何一条断言覆盖
`resolveDirectorModelTarget('shot-sfx')`。

**规则**：

- 一个节点类型可以同时有**文本职责**与**媒体职责**。路由建模必须能分别表达，
  不能用一个 `domain` 字段把节点二分。
- 凡是以 `Record<CanvasNodeType, …>` 或 `Record<PipelineStage, …>` 表达的映射，
  TypeScript 只保证键齐全，**不保证语义正确**。这类映射改动必须配一条遍历
  `DIRECTOR_NODE_TYPES` / `PIPELINE_STAGES` 全集的断言。
- 给任意 dispatcher 加「不支持 / 不能 / 未知」的硬抛之前，先确认现有节点类型里
  没有正在走这条路的。历史成功记录（artifacts 表按 `node.type` 分组）是最快的证据。

**已落地护栏**：`src/features/ai/route-target.ts` 把 `ROUTE_TARGET`（节点的主职责
路由）与会话路由分开——`model-routing.ts` 的 `sessionTarget()` 把媒体域节点的
Director 会话改写为 `project-plan` 文本任务，不再对媒体域抛错。默认供应商改为
按 `AiTaskKind` / 媒体 kind 声明（不再按节点类型声明，消除双真值），模型推导
统一收进 `route-provider-defaults.ts` 的 `providerDefaults()`，设置页展示与
实际执行调用同一份推导。`model-routing.test.ts` 新增三条断言：全部
`DIRECTOR_NODE_TYPES` 都能解析出 Director 会话模型；媒体泳道节点会话绑定文本
路由而非 TTS/ASR 路由；展示模型必须等于执行模型。真实链路验证见对应提交记录
（项目 bd2c8979 的 5 个 shot-sfx + 5 个 shot-subtitle 节点从 failed 转 succeeded，
产物 content_hash 与磁盘字节核对一致）。

---

## 5. 模式 D：异步媒体未就绪被当成产物损坏

**症状**：FABRICATE 或 ASSEMBLE 报 `audioManifest` / `audioAllocation` 合同校验失败，
让人以为产物损坏，实际只是配音还没生成完。

**真实事故**：配音是异步链（INGEST 成功后才排队合成），`director-ingest-audio` 尚未存在时，
旧实现回落去读只含 `scriptUnits` 的 `director-ingest`，再用音频 schema 硬解析。

**规则**：

- 读取异步媒体产物必须 `safeParse` 后给出**明确的「尚未就绪」错误**，
  不能把文本产物丢给音频 schema 硬解析。
- 「尚未就绪」的类别是 `MEDIA_NOT_READY`，`retryable=true`，文案要说明配音是异步生成的。
  它的文案里含「缺少」，所以在 `MESSAGE_RULES` 里必须排在「上游产物缺失」规则**之前**。
- 文本主链不得因为音频未就绪而阻塞：SHOT_SPEC 只绑定来源文本，不得编造时长。

---

## 6. 模式 E：fixture 退化成窄形状

**症状**：单测与 pg 测试全绿，真实运行 100% 失败。

**真实事故**：所有 script unit fixture 都写成 `{ unitId, text }`，恰好绕开了
真实 INGEST 产物里的 `order`；模式 A 的 bug 因此存活到线上。

**规则**：

- 阶段输入 fixture 必须使用**真实产物形状**：可选字段能填就填满，尤其是提示词里
  明确要求模型输出的字段。
- 断言「能跑通」时优先用真实链路能产出的最大合法对象，而不是最小对象。最小对象只用于
  「必填字段缺失必须失败」这类反向断言。
- 一份 fixture 只在一个地方定义，多个测试复用；不要在每个测试文件里各写一份窄版本。

---

## 7. 模式 F：dev server 持有旧模块

**症状**：代码已修好、测试已绿，重试节点仍然报同一个旧错误。

**真实事故**：修好 SHOT_SPEC 后第一次重试仍失败，报文与修复前逐字相同。
原因是长驻的 `next dev` 进程持有队列 handler 的旧模块实例，HMR 没有替换它。
`taskkill /PID <pid> /F` 重启后同一个节点立刻成功。

**规则**：改动 queue handler、stage runner、模型路由或任何被 `initQueue` 持有的模块后，
必须重启 `pnpm dev` 再验证。用真实节点状态变化（`failed` → `succeeded`）作为证据，
不要用「代码看起来对了」代替。

---

## 8. 工作流类改动的提交前清单

在 `AGENTS.md` §8 的通用门禁之外，涉及本文覆盖的链路时补做：

- [ ] 改动的合同是否已有 SSOT？有则复用，无则**只建一处**（模式 A）。
- [ ] 是否新增了「不支持 / 不能 / 未知」的硬抛？现有节点类型里是否有正在走这条路的（模式 C）。
- [ ] 是否改了 `Record<CanvasNodeType, …>` / `Record<PipelineStage, …>`？是否补了全集遍历断言（模式 C）。
- [ ] 新的失败路径落到哪个 `WorkflowErrorCode`？`retryable` 是否诚实（模式 B）。
- [ ] fixture 是否是真实产物形状（模式 E）。
- [ ] 验证时是否重启过 dev server，并用节点状态与产物哈希作证据（模式 F）。
- [ ] 真实产物证据：`artifacts.content_hash` 与磁盘字节 SHA-256 逐条核对一致。

真实证据的取法示例：

```powershell
docker exec purpleink-dev-postgres-1 psql -U cvc -d cvc -A -t -F "|" -c `
  "select content_hash, storage_key from artifacts where project_id='<projectId>' and kind='<kind>'" |
  ForEach-Object {
    $parts = $_ -split '\|'
    if ($parts.Count -eq 2) {
      $actual = (Get-FileHash -LiteralPath (Join-Path ".data/artifacts" $parts[1]) -Algorithm SHA256).Hash.ToLower()
      "match=$($actual -eq $parts[0]) $($parts[1])"
    }
  }
```

---

## 9. 已知未修项

| 项 | 模式 | 现状 |
| --- | --- | --- |
| `docs/issues/ISSUE-005`、`Batch-002` 仍写 `measureMp3` | — | 函数已更名 `measureAudio`，历史文档未同步 |
| `src/lib/queue/init.test.ts` 全量并行下偶发失败 | — | 卡在 `vi.resetModules()` 的模块隔离；单独执行与重跑均通过 |

修完任一项时，把该行删掉并在对应模式的「已落地护栏」里写清断言位置。

已修：`shot-sfx` / `shot-subtitle` 无法解析 Director 文本模型（模式 C）、
`DEFAULT_PROVIDER` 与 `media_routes` 双真值（模式 A）、内部路由矛盾仍走文案
规则（模式 B）——见 §2、§3、§4 的「已落地护栏」。

---

## 10. 已核对为不存在同类问题的部分

以下是按模式 A / C 逐一核对过的结论，避免重复排查：

- **阶段输入键对齐**：`runtime-artifact-reader.resolveDirectorInput` 六个阶段的返回键
  与对应 prompt 输入 schema 的 `.strict()` 键集合逐一比对一致（INGEST / DIRECT /
  SHOT_SPEC / FABRICATE / ASSEMBLE·score·shot-sfx·shot-subtitle / FINALIZE·export·shot-qa）。
- **嵌套契约**：除已修的 `shotSpecTargetSchema.sourceUnit` 外，其余嵌套结构
  （`scriptUnitSchema`、`shotAllocationSchema`、`audioAllocationSchema`、`audioManifestSchema`、
  `directorShotSchema`）全部直接 import SSOT，无平行定义。
- **shot plan**：运行时用 `passthrough`，模型可以多输出字段而不炸；严格校验只发生在
  `validate_shot_plan` 工具门禁里，职责分离正确。
- **INGEST 旁路字段**：`createProject` 把 `visualTheme` 存在 `payload` 旁路而非
  `directorInput`，且 `stage-prompt.test.ts` 已有反向断言锁死「visualTheme 混进
  directorInput 必须失败」。
- **渲染域**：`FrameSpec` 等结构用 TS interface + 单个 `renderSpecSchema` 表达，
  `server/` 侧没有平行 zod schema，不存在多余键硬失败风险。
