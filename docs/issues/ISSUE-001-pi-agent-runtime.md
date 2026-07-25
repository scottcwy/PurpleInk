# ISSUE-001 · Director pi-agent 运行时缺失，六阶段全部不可执行

- 优先级：**P0（阻断）**
- 状态：`done`（2026-07-25，见 §10）
- 范围：前端画布 Director。**不得触碰 `server/**`**（后端是另一套独立智能体，见 `README.md` §0）
- 依赖：无。本 issue 是整条链路的拱心石
- 阻塞：ISSUE-002、ISSUE-005、ISSUE-014

## 1. 症状

画布上任何节点点「执行」，或点「一键启动」后自动推进到任一 director 节点，
节点立即转 `failed`，错误信息为：

```text
NOT_AVAILABLE_STAGE_A: Director Pi runtime is not wired in Stage A
```

六个阶段（`INGEST`、`DIRECT`、`SHOT_SPEC`、`FABRICATE`、`ASSEMBLE`、`FINALIZE`）
一个都执行不了，因此没有任何 artifact 产生，链路在第一步就终止。

## 2. 证据

### 2.1 运行时是无条件抛错的空壳

`src/features/director/pi-session.ts:46-57`

```ts
/**
 * Stage A intentionally does not ship the historical Pi runtime.
 * Keeping the function contract lets existing callers compile while making the
 * missing capability explicit instead of returning fabricated output.
 */
export async function createDirectorSession(
  _input: DirectorSessionInput,
): Promise<DirectorSession> {
  throw new Error(
    `${STAGE_A_UNAVAILABLE_CODE}: Director Pi runtime is not wired in Stage A`,
  );
}
```

`src/features/director/session-store.ts:19-45`——`open` / `create` / `resume` 全部走 `unavailable()`：

```ts
export class DirectorSessionStore {
  async open(_input: SessionStoreInput): Promise<StoredDirectorSession> {
    return this.unavailable();
  }
  // create / resume 同
  private unavailable(): never {
    throw new Error(
      `${STAGE_A_UNAVAILABLE_CODE}: Director Pi session storage is not wired in Stage A`,
    );
  }
}
```

注意 `StoredDirectorSession.session` 的类型被写成 `never`（`session-store.ts:16`），
这是 stub 化留下的痕迹，实现时要恢复为 pi 的 `Session` 类型。

### 2.2 唯一调用点

`src/features/director/stage-runner.ts:152-158`——所有阶段共用这一处：

```ts
session = await dependencies.createSession({
  projectId, nodeId, nodeType: context.nodeType, stage,
  resumeSessionKey: context.resumeSessionKey,
})
```

`src/features/director/fabricate.ts:26` 是第二个引用点（`shot-codegen` 专用，见 ISSUE-002）。

### 2.3 依赖包根本没安装

```text
@earendil-works/pi-agent-core   不在 package.json，不在 pnpm-lock.yaml，node_modules 无此目录
@earendil-works/pi-ai           同上
```

### 2.4 门禁被开洞，掩盖了这个缺口

`vitest.config.ts:8-17`

```ts
exclude: [
  ...configDefaults.exclude,
  '**/*.pg.test.ts',
  // Stage A explicitly removes these historical Pi, Trigger, and SQLite contracts.
  'src/features/director/pi-session.test.ts',      // <- 391 行，本 issue 的规格书
  'src/features/director/session-store.test.ts',   // <- 81 行，本 issue 的规格书
  'src/features/pipeline/contracts/contracts.test.ts',
  'src/features/pipeline/contracts/task-source-boundary.test.ts',
  'src/lib/db/runtime-boundary.test.ts',
],
```

`tsconfig.json:41-50` 又把前 3 个从 typecheck 排除，
于是 `session-store.test.ts:4` 的 `import type { AgentMessage } from '@earendil-works/pi-agent-core'`
引用未安装包也不报错。

**这就是 `pnpm test` 98 files 全绿、`pnpm typecheck` exit 0，而运行时完全死掉的原因。**

## 3. 根因

历史 Pi 运行时在「Stage A 迁移」时被整体摘除（commit `cec1a9c chore: close stage a migration`），
接口契约、输出提取器、工具定义、提示词、artifact 门禁**全部保留**，
只把「会话创建」与「会话持久化」两个实现替换为抛错壳，并同步在测试与类型门禁里开洞。

因此这不是设计缺陷，是**一次未完成的移植**。要补的是实现，不是重构架构。

## 4. 规格书：现有测试就是需求

`src/features/director/pi-session.test.ts`（391 行，8 个用例）与
`src/features/director/session-store.test.ts`（81 行，3 个用例）
已经把预期行为写死了。**实现必须让这两个文件在解除 exclude 后原样通过，不允许改测试来迁就实现。**

### 4.1 `pi-session.test.ts` 逐条要求

| 用例 | 要求 |
| --- | --- |
| `restores context, adapts project tools, and persists message_end once` | 用 `session.buildContext()` 恢复历史消息作为 `initialState.messages`；把项目的 `DirectorTool[]` 适配成 pi 的 `AgentTool[]`（`agent.state.tools` 长度一致）；`message_end` 事件按 `['user','assistant']` 顺序各 `appendMessage` 一次；`session` 对外只暴露 `['close','id','run','storageKey']` 四个键；systemPrompt **不得包含 `Skill`** |
| `closes the subscription and session store` | `session.close()` 必须退订 + 关闭 store，`closeStore` 恰好调用一次 |
| `returns the same project session surface for %s`（× 6 阶段） | 六个阶段的返回面完全一致 |
| `通过 message_update 捕获流式增量并按 projectId:nodeId 推送事件总线` | 监听 `message_update`，**推送增量差值**到 `streamBus.publish(\`${projectId}:${nodeId}\`, delta)`。断言是 `[['project-1:node-1','完'], ['project-1:node-1','成']]`——注意是 `'成'` 而非 `'完成'`，必须做前缀 diff |
| `constructs the selected Gemini runtime from the trusted node type` | 以 `resolveDirectorModelTarget(nodeType, 'text')` 选型；Gemini 走**原生 Google API**：`createProvider({ id:'gemini', baseUrl:'https://generativelanguage.googleapis.com/v1beta', api: googleGenerativeAIApi(), models:[{ id, provider:'gemini', api:'google-generative-ai', baseUrl:'https://generativelanguage.googleapis.com/v1beta' }] })`。即把配置里的 `/v1beta/openai/` **剥成 `/v1beta`** |
| `separates validated Tool arguments from display text and omits thinking from storage` | `artifactContent` 取 tool 实参序列化值，`displayText` 取最后一条 assistant 文本；`type:'thinking'` 内容**绝不落盘**（断言 `appendMessage` 调用里不含该字符串） |
| `does not reuse a successful Tool result from restored history` | 恢复的历史里即使有 `details.ok===true` 的旧 toolResult，也不能被当成本轮输出；本轮 `ok:false` 时必须抛 `code:'DIRECTOR_TOOL_OUTPUT_MISSING'` |
| `fails explicitly instead of falling back when the selected provider has no key` | `apiKey` 为 null 时抛 `Gemini API Key 未配置`，**且必须已调用 `closeStore` 一次**（不许泄漏 session） |

### 4.2 `session-store.test.ts` 逐条要求

| 用例 | 要求 |
| --- | --- |
| `creates JSONL under the storage-managed root and returns a relative key` | 构造签名是 `new DirectorSessionStore(storage)`（**当前 stub 的构造器不接参数，必须改**）；内部用 `storage.localPath('pi-sessions')` 定位根；`handle.storageKey` 必须是**相对路径**且匹配 `/^pi-sessions\/.+\.jsonl$/`；文件真实存在 |
| `restores persisted messages through Session.buildContext` | 跨两个 store 实例，`create` → `appendMessage` → `close` → 新实例 `resume(key)` → `buildContext()` 得到完全相同的消息；`resumed.storageKey === created.storageKey` |
| `rejects resume keys outside the pi-sessions storage prefix` | `resume('../outside.jsonl')` 抛 `非法 Pi 会话 storageKey`（路径穿越防护，与 `LocalFsStorage` 的 root 校验同源） |

## 5. 上游 API 已核实（针对 0.82.0）

已实际安装 `@earendil-works/pi-agent-core@0.82.0` 并读取 `.d.ts` 比对：

| 测试 mock 的 | 真包实际 | 结论 |
| --- | --- | --- |
| `new Agent({ initialState })` | `AgentOptions.streamFn` 是**必填**，`initialState` 可选 | mock 偏松，实现必须传 `streamFn`（用 `createModels(...).streamSimple`） |
| `agent.subscribe(fn)` | `subscribe(listener: (event: AgentEvent, signal: AbortSignal) => …): () => void` | 一致，返回退订函数 |
| `agent.prompt(text)` / `waitForIdle()` / `abort()` | 全部存在 | 一致 |
| 事件 `message_update` / `message_end` | 属于 `AgentEvent` 联合类型 | 一致 |
| `state.{systemPrompt,model,tools,messages}` | `AgentState` 同名字段，`tools`/`messages` 是 accessor（赋值会复制顶层数组） | 一致 |
| `session.appendMessage()` / `buildContext()` | `Session` 类同名方法，`buildContext()` 返回 `SessionContext` | 一致 |
| `createProvider` / `createModels` / `envApiKeyAuth` | `pi-ai` 均导出；`createModels(opts?): MutableModels`，带 `setProvider` | 一致 |
| `pi-ai/api/google-generative-ai.lazy`、`openai-completions.lazy` | 子路径导出 `./api/*` 真实存在 | 一致 |

两处必须写适配层：

1. **工具**：项目的 `DirectorTool.execute(input, signal)` → pi 的
   `AgentTool.execute(toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult>`。
   参数 schema 需从 JSON Schema 转 **TypeBox `TSchema`**（`pi-ai` 直接 re-export `Type` 与 `TSchema`，无需新增依赖）。
   `AgentTool` 还要求 `label` 字段——项目的 `DirectorTool` 已经有 `label`，可直接映射。
2. **会话存储**：`JsonlSessionStorage` 位于 `dist/harness/session/jsonl-storage`，
   需要包一层把绝对路径约束在 `storage.localPath('pi-sessions')` 之内。

## 6. 版本选择：必须用 0.80.10，不是 latest

`npm view @earendil-works/pi-agent-core` 的发布时间：

```text
0.80.10  2026-07-16T22:04:54Z   <- 9 天，唯一满足「>= 7 天」的最新版
0.81.0   2026-07-21T13:33:26Z      4 天
0.81.1   2026-07-21T16:44:53Z      4 天
0.82.0   2026-07-24T06:11:41Z      1 天，latest
```

AGENTS.md 引用的供应链规则要求「优先使用发布满 7 天的版本」，
因此**锁定 `0.80.10` 精确版本**（`pi-agent-core` 与 `pi-ai` 同版），
禁止 `^`、`~`、`latest`、`*` 等浮动范围。

`pi-agent-core@0.82.0` 的依赖为
`@earendil-works/pi-ai ^0.82.0`、`diff 8.0.4`、`ignore 7.0.5`、`typebox 1.1.38`、`yaml 2.9.0`。
`0.80.10` 的依赖需在实现时复核。

> **未完成的核实（本 issue 的第一项任务）**：
> §5 的 API 比对是针对 **0.82.0** 做的，**`0.80.10` 的 API 一致性尚未验证**。
> 实现者必须先在仓库外的临时目录安装 `0.80.10`，确认
> `Agent`、`AgentEvent`（含 `message_update` / `message_end`）、`AgentState`、`AgentTool`、
> `Session.appendMessage` / `buildContext`、`JsonlSessionStorage`、
> `createModels` / `createProvider` / `envApiKeyAuth`、
> 以及 `./api/google-generative-ai.lazy` / `./api/openai-completions.lazy` 子路径**全部存在且签名一致**。
> 若 `0.80.10` 缺失任一项，记录具体差异后再决定升到 `0.81.1`，
> 并在本文件追加「版本偏离记录」说明理由。**不得直接跳到 0.82.0。**

## 7. 修复范围

### 7.1 必改文件

| 文件 | 动作 |
| --- | --- |
| `package.json` | 新增两个精确版本依赖（用 `pnpm add` 生成，不手改 `pnpm-lock.yaml`） |
| `src/features/director/pi-session.ts` | 用真实实现替换抛错壳；保留现有导出的类型契约不变 |
| `src/features/director/session-store.ts` | 改为 `constructor(storage: StorageAdapter)`，实现 `create` / `resume` / `close`；`StoredDirectorSession.session` 类型从 `never` 改回 pi 的 `Session` |
| `vitest.config.ts` | **删除第 12、13 行**两条 exclude（只删这两条，第 14–16 行归 ISSUE-006） |
| `tsconfig.json` | **删除第 47、48 行**两条 exclude（第 49 行归 ISSUE-006） |
| `tests/stage-a-unavailable.test.ts` | **删除整个文件**。它锁定的是「故意不可用」这一临时状态，与本 issue 目标直接冲突 |

### 7.2 规模门禁与拆分要求

`pi-session.ts` 实现完整逻辑后必然超过 250 行目标值与 350 行硬上限。
AGENTS.md 要求**在当前任务内按真实职责拆分，禁止只套 re-export 壳**。建议落点：

```text
src/features/director/
  pi-session.ts              会话装配与 run 编排（对外唯一入口，保持现有导出面）
  pi-provider.ts             DirectorModelTarget -> pi Provider/Model 构造（gemini 原生 / stepfun openai-compat）
  pi-tool-adapter.ts         DirectorTool -> AgentTool，JSON Schema -> TypeBox TSchema
  pi-stream-bridge.ts        message_update 前缀 diff -> streamBus.publish
  session-store.ts           JSONL 持久化 + pi-sessions 前缀约束
```

每个文件一个变化原因。`pi-output.ts`（180 行，输出提取器）**已经写好且正确，不要动**。

### 7.3 禁区

1. 不改 `pi-session.test.ts`、`session-store.test.ts` 的任何断言。
2. 不改 `pi-output.ts`、`stage-runner.ts`、`stage-prompt.ts`、`prompts/**`、`schemas/**`、`tools/**`
   （这些都是完好的既有实现；`stage-runner.ts` 若确需改动，先在本文件追加说明）。
3. 不新增 `import ... from 'openai'`——`verify:v3` 的债务上限已用满 3 个（见 `README.md` §9）。
4. 不在 `src/features/canvas/**` 里 import `@earendil-works/pi-*`，门禁会直接报 `CANVAS_FORBIDDEN_IMPORT`。
5. 不引入 `@openai/agents*`，零容忍。
6. 不因为「跑不通」就让阶段返回兜底文本或假 artifact。失败必须如实抛错并落 `directorError`。
7. `thinking` / 隐藏推理 / 原始 tool 实参 / 凭据一律不得写入 JSONL、日志、流式输出或 UI。

## 8. 验收标准

1. `vitest.config.ts` 与 `tsconfig.json` 中属于本 issue 的 4 条 exclude 已删除。
2. `pnpm test` 通过，且**文件数从 98 增加到 100**（两个规格文件真的跑起来了），
   `pi-session.test.ts` 8 个用例、`session-store.test.ts` 3 个用例全绿。
3. `pnpm typecheck` exit 0。
4. `pnpm verify:v3` 的违规数**不多于修复前**（修复前为 2 条，均属 ISSUE-010）；
   `directOpenAiClientImports` 仍为 3，`agentsSdkPackages` / `agentsSdkImports` 仍为空。
5. `tests/stage-a-unavailable.test.ts` 已删除，全仓库 grep `NOT_AVAILABLE_STAGE_A` 无残留。
6. `pnpm build` 成功。
7. **真实运行证据**（不接受仅单测通过）：
   在配好 `GEMINI_API_KEY` 的环境（依赖 ISSUE-003）下，对一个真实项目手动触发 `INGEST`：
   - `POST /api/director/stage` 返回 200 与 jobId；
   - 节点状态 `idle → pending → running → success`；
   - `artifacts` 表出现 `kind='director-ingest'` 记录，`content_hash` 为 64 位 hex，
     且与 storage 内实际字节的 SHA-256 一致；
   - `artifacts` 表出现 `kind='pi-session'` 指针，对应 `pi-sessions/**.jsonl` 文件真实存在；
   - 打开该 JSONL，确认**不含** `thinking` 内容、不含 API key；
   - `GET /api/director/stream/{nodeId}?projectId=` 能收到 SSE 增量。
   把上述 HTTP 响应与 SQL 查询结果留档到 `docs/issues/evidence/issue-001/`。
8. 无法完成第 7 项时，必须说明原因，**不得声称已验证**。

## 9. 交付后应立即解锁

ISSUE-002（`shot-codegen` 接缝）。两者串起来才有第一个单镜 MP4。

## 10. 修复记录（2026-07-25）

### 10.1 版本核实结论

`0.80.10` 未做偏离，直接采用。方法：在仓库外临时目录 `npm install` 该精确版本，
读 `dist/**/*.d.ts` 并写探测脚本实跑（`Agent`、`AgentTool` 校验、
`JsonlSessionStorage.create/open` + `Session.appendMessage/buildContext`、
`createModels/createProvider/envApiKeyAuth`、`google-generative-ai.lazy` /
`openai-completions.lazy`），确认与规格测试的 mock 假设完全一致。

### 10.2 落地文件

按 §7.2 建议拆分，`pi-session.ts` 保持对外导出面不变：

- `pi-session.ts` — 会话装配与 `run()` 编排
- `pi-provider.ts` — `DirectorModelTarget` → pi Provider/Model；gemini 剥
  `/v1beta/openai/` 回原生 `/v1beta`，stepfun 走 `openai-completions`；
  缺 Key 显式抛 `${Provider} API Key 未配置` 不兜底
- `pi-tool-adapter.ts` — `DirectorTool` → `AgentTool`（JSON Schema 直接交给
  pi 校验器，pi 的 `validateToolArguments` 对无 TypeBox Kind 符号的纯 JSON
  Schema 有专门兼容路径，不需要新增第二套 schema 真值）
- `pi-messages.ts` — 消息投影 + `thinking` 脱敏（落盘前过滤）
- `pi-stream-bridge.ts` — `message_update` 增量前缀 diff → `streamBus`；
  `message_end` → `appendMessage`
- `session-store.ts` — 改为 `constructor(storage: StorageAdapter)`；
  `storageKey` 恒为 `pi-sessions/` 前缀相对路径；`resume()` 校验前缀且解析
  后仍在 root 内才放行

删除：`tests/stage-a-unavailable.test.ts`；`vitest.config.ts` / `tsconfig.json`
中锁定本 issue 的 4 条 exclude。

### 10.3 验证结果

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | 通过 |
| `pnpm test` | 100 files（98→100）/ 433 passed；`pi-session.test.ts` 8 例、`session-store.test.ts` 3 例全绿，未改一处断言 |
| `pnpm verify:v3` | 违规数未增（仍是 baseline 既有 2 条超行）；`directOpenAiClientImports`=3、`canvasForbiddenImports`=15、`agentsSdk*`=0 均未超 debt cap |
| `pnpm build` | 成功 |
| grep `NOT_AVAILABLE_STAGE_A` | 全仓库无残留 |

真实运行证据（`GEMINI_API_KEY` 经 `POST /api/settings` 真实 API 校验后写入
Postgres 加密存储，对一个真实项目触发 `POST /api/director/stage` INGEST）：

- Job：`pending → running → done`
- SSE `/api/director/stream/{nodeId}`：收到 5 个真实 `delta` 增量事件 + `done`
- `artifacts` 表：`director-ingest` / `director-stream-log` / `pi-session` 三条
  记录，`content_hash` 与本机文件实际字节的 SHA-256 核对一致
- `canvas_nodes`：`script-import` 节点 `status` 落 `succeeded`，
  `directorArtifactId` 指向 `director-ingest`，`directorError` 为空
- `pi-sessions/**.jsonl` 人工核对：**不含** `thinking` 内容、**不含** Gemini
  Key 明文（含 `AIza` 前缀检测）

证据文件：
- `docs/issues/evidence/issue-001/http-ingest-run.json`（HTTP + SSE 全量事件）
- `docs/issues/evidence/issue-001/sql-node-and-artifact-state.json`（SQL 查询
  结果 + 本机文件哈希核对）

### 10.4 遗留说明

`pi-session.ts` 装配逻辑本身控制在 150 行内（未触及 250/350 行门禁），
拆分后 5 个新文件均在目标值内，未产生新的超行债务。
