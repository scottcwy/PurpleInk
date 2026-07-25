# ISSUE-003 · Next 应用进程内无 AI 凭据，配置真值不对称

- 优先级：**P0（阻断）**
- 状态：`open`
- 范围：**纯配置与文档，不改任何 `src/**` 代码**
- 依赖：无。可与其他 issue 完全并行
- 阻塞：ISSUE-001 的运行时验收、ISSUE-002、ISSUE-005、ISSUE-014

## 1. 症状

即使 pi 运行时修好（ISSUE-001），Director 仍会在会话创建阶段抛：

```text
Gemini API Key 未配置
```

原因：Next 应用进程读不到任何 AI provider 凭据。

## 2. 证据

### 2.1 两个 env 文件的变量分布（只报变量名与是否非空，不回显值）

根 `.env.local` —— 3 个变量，**无任何 AI/TTS 凭据**：

```text
DATABASE_URL                 present
CVC_CREDENTIAL_MASTER_KEY    present
TEST_DATABASE_URL            present
```

`server/.env` —— 22 个变量全部非空，**AI/TTS 凭据全在这里**：

```text
STEP_API_KEY  STEP_BASE_URL  STEP_MODEL  STEP_VISION_MODEL
STEP_MIN_INTERVAL_MS  STEP_MAX_RETRIES
IMAP_HOST  IMAP_PORT  IMAP_SECURE  IMAP_USER  IMAP_PASSWORD  SIGNUP_PASSWORD
TTS_PROVIDER  LISTENHUB_API_KEY  LISTENHUB_API_BASE_URL
LISTENHUB_TTS_ENDPOINT  LISTENHUB_TTS_VOICE  LISTENHUB_TTS_RESPONSE_FORMAT
GEMINI_API_KEY  GEMINI_BASE_URL  GEMINI_PRIMARY_MODEL  GEMINI_FAST_MODEL
```

### 2.2 Next 侧读的是 `process.env`

`src/features/ai/gemini-config.ts:21-30`

```ts
const ENV_KEYS: Record<GeminiConfigField, string> = {
  baseUrl: 'GEMINI_BASE_URL',
  primaryModel: 'GEMINI_PRIMARY_MODEL',
  fastModel: 'GEMINI_FAST_MODEL',
}
const DEFAULTS: Record<GeminiConfigField, string> = {
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  primaryModel: 'gemini-3.6-flash',
  fastModel: 'gemini-3.1-flash-lite',
}
```

`server/.env` 只被 worker 的 `server/src/lib/load-env.ts` 加载，
Next 进程不会读它，因此 `GEMINI_API_KEY` 恒为 undefined。

### 2.3 凭据真值优先级本身是对的，缺的是写入面

`src/features/ai/config.ts:77-92` 的解析顺序：

```text
DB 路由（provider_credentials / model_routes / media_routes）  >  process.env  >  代码默认值
```

而且是**逐次调用实时读取**，没有 import 期快照——
所以「改了配置不影响后续 API 调用」这个需求**已经天然满足**，无需改代码。

不对称之处在于：
- 模型与 provider 选择：UI 可写（`POST /api/settings` → DB），✅
- **API Key**：UI 可写（加密进 `provider_credentials`），但**首次没有任何来源可用**，
  且 env 兜底路径在 Next 进程里是空的。

## 3. 关键约束：不得与后端智能体耦合

`server/` 是另一套独立智能体（详见 `README.md` §0）。因此：

- **不要**让 Next 去读 `server/.env`。
- **不要**改 `server/src/lib/load-env.ts` 让它向上回退到根目录。
- **不要**创建两套共用的 env 加载器或"统一配置层"。
- 两套各自持有 `GEMINI_API_KEY`、`STEP_API_KEY` 是**有意的隔离**，不是重复。

正确做法：根 `.env.local` **独立**登记自己需要的变量，与 `server/.env` 各自为政。

## 4. 明确不引入 YAML

需求里提到「可以引入 yaml 或其他机制，让改配置不影响 API 调用」。经核实**不需要**：

1. 热更新已经实现（§2.3）。
2. 现有真值层已经是三层且有清晰优先级；再加 YAML 会成为**第四套真值**，
   直接违反 AGENTS.md「一个职责只有一个真值」与 routing.md §0 的真值顺序。
3. 真正缺的是「首次凭据从哪来」，那是 env + 加密 DB 存储的职责，不是配置格式问题。

若未来确实需要文件化配置，必须先改 `AGENTS.md` 与 `docs/conventions/`，再落代码。本 issue 不做。

## 5. 修复范围

| 文件 | 动作 |
| --- | --- |
| 根 `.env.local` | 补齐 Next 侧所需 AI/TTS 变量（**不提交**，`.gitignore` 已覆盖） |
| 根 `.env.example` | 变量名与注释对齐，值留空；说明每个变量的消费方 |
| `docs/configuration/` | 新增或补充一页说明「前端 Director 与后端 worker 的凭据是两套，各自独立」 |

Next 侧至少需要：

```text
CVC_CREDENTIAL_MASTER_KEY     已有，凭据加密 master key（32 字节 canonical base64）
GEMINI_API_KEY                Director 默认 provider（7 个节点类型默认走 gemini）
GEMINI_BASE_URL               留空则用代码默认 https://generativelanguage.googleapis.com/v1beta/openai/
GEMINI_PRIMARY_MODEL          留空则 gemini-3.6-flash
GEMINI_FAST_MODEL             留空则 gemini-3.1-flash-lite
STEP_API_KEY                  shot-sfx(TTS) 与 shot-subtitle(ASR) 默认走 stepfun
STEP_BASE_URL / STEP_MODEL / STEP_VISION_MODEL   可留空用默认
```

默认 provider 映射见 `src/features/ai/model-routing.ts:30-40`：
`shot-sfx` 与 `shot-subtitle` 默认 `stepfun`，其余 7 个节点类型默认 `gemini`。
因此**两个 key 都需要**，否则 ASSEMBLE 阶段会失败。

## 6. 上游可用性已实测（2026-07-25，用 `server/.env` 里的 key 打真实 API）

| 探测项 | 结果 |
| --- | --- |
| `GET /v1beta/models` | 200，56 个可用模型 |
| `gemini-3.6-flash` | 存在 |
| `gemini-3.1-flash-lite` | 存在 |
| OpenAI 兼容端点 function calling | 成功返回 `validate_shot_plan` 工具调用，2312ms |
| SSE（`/v1beta/openai/chat/completions`） | 200 `text/event-stream` |
| SSE（原生 `:streamGenerateContent?alt=sse`） | 200 `text/event-stream` |
| 并发 16 路 | 16/16 成功，墙钟 1482ms，零限流 |

即：**配置里登记的两个模型名都是真实存在的，key 有效，并发 >10 无障碍。**
不需要更换模型或降低并发预期。

## 7. 安全要求（AGENTS.md §7）

1. 只引用变量名，**不在任何文档、日志、commit、截图、对话中回显值**。
2. 不把 secret 写进源码、测试 fixture 或 `NEXT_PUBLIC_*`。
3. 客户端不得解析 provider credential。
4. master key 只从 server-only 环境读取，**不得明文 fallback**
   （现状已合规：`credential-envelope.ts:45-48` 缺失即抛错）。
5. 不提交 `.env*`。提交前跑 `git diff --check` 并确认 `.gitignore` 生效。
6. `tests/env.test.ts` 有敏感变量断言，改 `.env.example` 后需确认它仍通过。

## 8. 验收标准

1. `pnpm test` 通过，`tests/env.test.ts` 绿。
2. `.env.example` 的变量名与代码实际读取的键**逐一对应**，无漂移。
   （历史上出过此类问题：`CAPTURE_DRIVER` 从未被代码读取，实读 `BROWSER_DRIVER`，
   见 `docs/reviews/qoder-architecture-cleanup-2026-07-25.md` F-05。）
3. 在 Next 进程内（例如一个临时脚本或 API 路由）验证
   `getGeminiConfig()` 返回的 `apiKey` 非空、`getStepfunConfig()` 的 `apiKey` 非空，
   并且 `describeGeminiConfig()` 只回 `configured/verifiedAt/updatedAt`，**不回显明文或密文**。
4. `POST /api/settings` 用**一个错误的 key** 提交，必须返回 **422** 且不覆盖已有值
   （routing.md §4.1 约定 3；现状已实现于 `src/app/api/settings/route.ts:105-113`，本项为回归确认）。
5. `git status --porcelain` 确认没有 `.env*` 被 stage。
6. 证据留档到 `docs/issues/evidence/issue-003/`（**只记录变量名与 present/absent，不记录值**）。

## 9. 备注

本 issue 不改代码，是 ISSUE-001 第 7 项验收（真实运行证据）与 ISSUE-014 端测的前置条件。
建议第一批就完成，成本极低但解锁面很大。
