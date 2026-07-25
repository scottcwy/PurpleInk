# ISSUE-013 · `features/ai` 适配器与 pi-ai 会形成第二套 provider 客户端

- 优先级：**P2**
- 状态：`in-progress`（第一步分析已完成，见 §5 结论；第二步等 ISSUE-001 验收）
- 范围：`src/features/ai/**`、`src/features/render/vision-qa.ts`、`src/features/audio/stepfun-audio-client.ts`
- 依赖：**分析可立即做（第一批）；改动必须等 ISSUE-001 落地**
- 性质：职责边界界定，先出结论文档再动代码

## 1. 问题

ISSUE-001 会引入 `@earendil-works/pi-ai` 作为 Director 的 provider 客户端。
届时仓库里会有**两套 provider 客户端**：

| 客户端 | 位置 | 用途 |
| --- | --- | --- |
| `openai` SDK 直连 | `features/ai/gemini-adapter.ts`、`features/ai/stepfun-adapter.ts`、`features/render/vision-qa.ts` | 现有 |
| `pi-ai` | ISSUE-001 新增，`features/director/**` | 新增 |

如果不界定边界，就会出现「同一个 provider 有两条调用路径、两套超时/重试/错误映射」，
这正是 AGENTS.md 禁止的「同一职责的第二套实现」。

## 2. 硬约束：`verify:v3` 的债务上限已用满

`scripts/verify/v3-architecture.ts` 的 `DIRECT_OPENAI_CLIENT_IMPORT` 规则，
baseline 上限固定为 **3**，当前恰好用满：

```json
"directOpenAiClientImports": [
  { "path": "src/features/ai/gemini-adapter.ts",  "specifier": "openai", "line": 2 },
  { "path": "src/features/ai/stepfun-adapter.ts", "specifier": "openai", "line": 2 },
  { "path": "src/features/render/vision-qa.ts",   "specifier": "openai", "line": 3 }
]
```

含义：

- **任何新文件 `import ... from 'openai'` 都会让 `pnpm verify:v3` 立刻失败**
  （`DEBT_CAP_EXCEEDED`）；
- 反之，减少这三处不会失败（上限只管不增长）。

所以门禁的意图很清楚：**`openai` 直连是要收缩的存量债务，不是可扩展的方案。**

## 3. 当前各处的真实职责

| 文件 | 行数 | 真实职责 | 是否被生产路径调用 |
| --- | --- | --- | --- |
| `features/ai/gemini-adapter.ts` | 59 | `chat()` + key 校验 | `chat()` **无生产调用方**（仅测试）；key 校验被 `/api/settings` 使用 |
| `features/ai/stepfun-adapter.ts` | 74 | `chat()` + key 校验 + `createLlmFromSettings()` | 同上，需逐一 grep 确认 |
| `features/render/vision-qa.ts` | 321 | 视觉 QA（看图核对 `mustShow` / `mustAvoid`） | 是，`shot-qa` 阶段经 `stage-effects.ts` 调用 |
| `features/audio/stepfun-audio-client.ts` | 221 | TTS / ASR | 是；**用 fetch 还是 openai SDK 需确认**（不在上述 3 条里，说明未直连 openai） |
| `features/ai/config.ts`、`gemini-config.ts`、`model-routing.ts` | 191 / 144 / 217 | 配置解析与路由决策，**不发请求** | 是，pi-session 也会依赖 `resolveDirectorModelTarget` |

关键观察：**`config.ts` / `gemini-config.ts` / `model-routing.ts` 是纯决策层，
不属于「第二套客户端」，pi-agent 应当复用它们**
（`pi-session.test.ts:110-123` 正是 mock 了 `model-routing`，证明这是预期设计）。

真正需要界定的只有三处发请求的地方。

## 4. 建议的边界（待确认后写入本文件为结论）

```text
决策层（唯一，两套客户端共用）
  features/ai/config.ts          StepFun 配置解析
  features/ai/gemini-config.ts   Gemini 配置解析
  features/ai/model-routing.ts   nodeType + capability -> DirectorModelTarget
  features/credentials/**        加密凭据存取
  features/routing/**            DB 路由表

执行层
  pi-ai        ->  Director 六阶段的所有对话式 LLM 调用（含 function calling、流式）
  openai SDK   ->  仅保留在 vision-qa.ts（多模态看图），且不再扩散
  fetch        ->  audio 的 TTS / ASR（音频接口形状与 chat 不同，独立合理）

key 校验
  validateGeminiKey / validateKey 保留在 features/ai
  但应评估能否改用轻量 fetch，从而把两个 adapter 的 openai 依赖降到 0
```

若上述成立，`gemini-adapter.ts` 与 `stepfun-adapter.ts` 的 `chat()` 方法
在 ISSUE-001 之后就是**死代码**，应删除，`directOpenAiClientImports` 可从 3 降到 1。

## 5. 分两步交付

### 第一步：分析（可立即做，不改代码）

产出一份结论写进本文件，必须回答：

1. `GeminiAdapter.chat()` / `StepfunAdapter.chat()` / `createLlmFromSettings()`
   分别有哪些生产调用方？（逐个 grep，排除 `.test.ts`）
2. `features/ai/index.ts`（19 行）当前导出了什么？
   `GeminiAdapter` 是否未导出？（初查：**未导出**，需确认）
3. `vision-qa.ts` 用 `openai` 是否必需？Gemini 与 StepFun 的多模态请求
   能否也走 pi-ai（`pi-ai` 是否支持图片内容块）？
4. `stepfun-audio-client.ts` 用什么发请求？
5. key 校验能否不依赖 `openai` SDK？
   （Gemini 侧已实测：`GET /v1beta/models?key=` 一个 fetch 即可验证，
   见 `README.md` §7。）

#### 第一步结论（2026-07-25 勘探，未改任何代码）

标记口径：`[已定]` 可直接作为第二步输入；`[条件性]` 须等 ISSUE-001 正式验收后复核再定死。

**1. `chat()` 三符号的生产调用方——零，均为死代码候选 `[已定，验收时复跑 grep]`**

- `GeminiAdapter`（`gemini-adapter.ts:41` 定义）：全 `src/` 仅 `gemini-adapter.test.ts:43-44`
  实例化并调用 `chat()`，无生产命中。
- `StepfunAdapter`：生产唯一实例化点是 `stepfun-adapter.ts:61`（`createLlmFromSettings()` 内部）；
  其余命中全在 `stepfun-adapter.test.ts:65,74,83`。
- `createLlmFromSettings`（`stepfun-adapter.ts:59` 定义）：仅被 `index.ts:5` 转发导出；
  全 `src/` 无任何 `from '@/features/ai'` 桶导入命中，桶导出的符号无生产消费方。
- `/api/settings` 只 import key 校验与存取：`route.ts:13`（`validateGeminiKey`）、
  `route.ts:19`（`saveApiKey, validateKey`），不触及任何 Adapter 类。
- 对第二步的影响：`chat()` 与 `createLlmFromSettings` 可安全删除；adapter 文件需保留的
  只有 key 校验与凭据存取。复核点：ISSUE-001 验收时复跑一次上述 grep。

**2. `index.ts`（19 行）导出面 `[已定]`**

- `:1` 类型 `ChatMessage / ChatOptions / LlmAdapter`；`:2` `stepfunSettingsSchema`；
  `:3-9` `StepfunAdapter / createLlmFromSettings / getStoredApiKey / saveApiKey / validateKey`；
  `:10-19` config 的 8 个符号。
- `GeminiAdapter` 确认**未导出**；`validateGeminiKey` 也未经桶导出，
  `route.ts:13` 走深路径 `@/features/ai/gemini-adapter`。
- 对第二步的影响：删除 `index.ts:4-5` 两行导出即可完成收敛，无 breaking change 风险。

**3. `vision-qa.ts` 的 openai 用法（请求形态 `[已定]`，去向 `[条件性]`）**

- 用法很薄：`vision-qa.ts:183` 经 `resolveDirectorModelTarget('shot-qa','vision')` 取 target，
  `:185-194` `new OpenAI({ apiKey, baseURL })` 做一次**非流式** `chat.completions.create`；
  `:210-225` 构造 OpenAI content-parts 图片块（base64 data URL，`detail:'high'`）。
  openai 类型渗透进函数签名（`ChatCompletionMessageParam` :180、
  `ChatCompletionContentPartImage` :216），改造时类型面需一并替换。
- 隐藏运行时行为：未显式设置超时/重试，走 SDK 默认（约 600s / 2 次重试），与 key 校验的
  显式 `15s / 0 retry` 不一致。第二步无论怎么改都必须把超时/重试显式化。
- pi-ai **类型层面已支持图片**：`node_modules/@earendil-works/pi-ai/dist/types.d.ts:239-243`
  （`ImageContent`）、`:274-278`（`UserMessage.content` 接受 `(TextContent | ImageContent)[]`），
  版本 0.80.10——§4 中「pi-ai 是否支持图片内容块」已有答案。
- `[条件性]` 去向：Gemini/StepFun 端点经 pi-ai 是否真实透传图片需运行时实测；且文件实测
  **341 行**（§3 表中 321 已过时），距 350 硬上限仅 9 行。短期保留 openai 于 vision-qa，
  迁移是可选项而非必需项，待 ISSUE-001 验收后单独评估。

**4. `stepfun-audio-client.ts` 用纯 fetch `[已定]`**

- `:74` 依赖注入 `fetcher: typeof fetch`，`:236` 默认注入全局 `fetch`；
  TTS `POST {baseUrl}/audio/speech`（`:100-117`）；ASR `POST {baseUrl}/audio/asr/sse`
  + 手写 SSE 解析（`:151-175`、`:208-224`）。零 openai 依赖。
- 对第二步的影响：无需任何动作，§4 中「audio 走 fetch 独立合理」成立。

**5. key 校验可 fetch 化 `[可行性已定，取舍留第二步]`**

- 现实现对称：`validateGeminiKey`（`gemini-adapter.ts:15-38`）、`validateKey`
  （`stepfun-adapter.ts:37-56`），均为 openai SDK 最小 chat 探测
  （`max_tokens:1`，显式 `timeout:15_000, maxRetries:0`）。
- 422 契约完全在 route 层：`route.ts:67-76` 校验失败走 `keyValidationError()`
  （`:105-114`，`status: 422`）且不落库，只依赖布尔返回值——替换校验实现零波及。
- Gemini 轻量替代已实测：`GET /v1beta/models?key=` 返回 200（见本目录 `README.md` §7）。
  StepFun 侧 `GET {baseUrl}/models` 未实测，第二步用真实 key 补证。
- 取舍必须在第二步决策：现探测校验的是「key + baseUrl + model 组合」，`GET /models`
  会弱化为仅验 key；替代方案是保留 chat 探测、仅把 openai SDK 换成
  fetch + `AbortSignal.timeout(15_000)`。

#### 附带结论

**决策层纯净性确认。** `config.ts` / `gemini-config.ts` / `model-routing.ts` grep
`fetch(` / `new OpenAI` / `from 'openai'` 零命中；热更新语义无缓存
（`model-routing.ts:144-165` 逐调用读 DB 路由表 + env）。`pi-session.test.ts:110-123`
mock 了 `@/features/ai/model-routing`，复用决策层是预期设计，§3 的关键观察成立。

**ISSUE-001 进度快照（2026-07-25）。** `pi-session.ts` 已是完整实现（`:2` import `Agent`
自 pi-agent-core），`package.json:25-26` 已锁 `@earendil-works/pi-agent-core@0.80.10` 与
`pi-ai@0.80.10`，`vitest.config.ts` / `tsconfig.json` 的 pi 相关 exclude 已删。
但 ISSUE-001 状态仍为 `open`——**第二步启动以其状态改 `done` 为准**（§7 禁区第 7 条）。

**两套客户端运行时行为对比（边界划分论据）。**

| 维度 | openai SDK（vision-qa / key 校验） | pi-ai（Director） |
| --- | --- | --- |
| 流式 | 否，一次性补全 | 是，`streamSimple` 流式优先 |
| 超时 | SDK 默认（校验处显式 15s） | 调用方自控 |
| 重试 | SDK 内建（默认 2 次；校验处 0） | 仅分类（`isRetryableAssistantError`），策略归调用方 |
| 错误映射 | 原样上抛 | 归一为稳定的 `DirectorRunError` 类别 |

**第二步收缩预测。** `directOpenAiClientImports`（baseline
`v3-architecture-baseline.json:4` 当前 3）：删两个 adapter 的 `chat()` 死代码
+ key 校验 fetch 化后 → **1**（仅 `vision-qa.ts:3`）；→ **0** 需单独评估 vision-qa 改造
（341 行门禁风险），建议 baseline 分两次下调。

### 第二步：收缩（等 ISSUE-001 落地后）

按第一步结论删除死代码，并**下调 baseline 的 `directOpenAiClientImports` 上限**
到收缩后的真实值——不下调等于把额度留给未来的违规。

## 6. 修复范围（第二步，依结论调整）

| 文件 | 动作 |
| --- | --- |
| `src/features/ai/gemini-adapter.ts` | 删除 `chat()`（若确认无调用方）；key 校验改 fetch 或保留 |
| `src/features/ai/stepfun-adapter.ts` | 同上 |
| `src/features/ai/index.ts` | 公开导出面收敛到「配置 + 路由 + key 校验」 |
| `src/features/ai/*.test.ts` | 同步 |
| `scripts/verify/v3-architecture-baseline.json` | `debtCaps.directOpenAiClientImports` 下调到真实值 |
| `src/features/render/vision-qa.ts` | 仅在第一步结论支持时才改；321 行已接近上限，改动需谨慎 |

## 7. 禁区

1. **不新增任何 `import ... from 'openai'`**，门禁会直接红。
2. 不为 pi-ai 再包一层「统一 LLM 抽象」——那是第三套。
   Director 直接用 pi-ai，QA 直接用现有客户端，各自清晰。
3. 不把 `config.ts` / `model-routing.ts` 的决策逻辑复制进 pi-session
   （必须复用；`pi-session.test.ts` 已经按复用来 mock）。
4. 不破坏配置的热更新语义（逐次调用实时读取，`DB > env > 默认值`）。
5. 不引入 `@openai/agents*`。
6. 不动 `server/src/lib/step-client.ts`——那是后端智能体自己的客户端与节流器，
   与本处**有意隔离**，不要合并（见 `README.md` §0）。
7. 第二步不得在 ISSUE-001 落地前动手，否则会删掉还在被使用的代码。

## 8. 验收标准

### 第一步

1. 本文件已补充 §5 五个问题的逐条结论，每条附 grep 证据（文件:行）。
2. 未改任何代码。

### 第二步

1. `pnpm verify:v3` **exit 0**，且 `directOpenAiClientImports` 的实际条数与
   baseline 的 `debtCaps` 值**同时下调且相等**。
2. `pnpm test`、`pnpm typecheck`、`pnpm build` 全绿。
3. `/api/settings` 的 key 校验行为不变：错误 key 返回 **422** 且不覆盖已有值。
   用真实错误 key 打一次真实请求留证。
4. `shot-qa` 的视觉 QA 仍能真实工作：用一个真实渲好的镜头跑一次，
   确认返回真实判定（不是恒真），证据留档到 `docs/issues/evidence/issue-013/`。
5. 全仓库 grep `from 'openai'` 的命中数与 baseline 一致。
