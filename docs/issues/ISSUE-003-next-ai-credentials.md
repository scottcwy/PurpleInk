# ISSUE-003 · Next 应用进程内无 AI 凭据，配置真值不对称

- 优先级：**P0（阻断）**
- 状态：`done`（深度修复完成；§8 全验收通过 + 证据归档于 `docs/issues/evidence/issue-003/`）
- 范围：**`docs/**` + `scripts/**` + `.env.example` + `tests/env.test.ts`，不改任何 `src/**` 代码**
- 依赖：无。可与其他 issue 完全并行
- 阻塞：ISSUE-001 的运行时验收、ISSUE-002、ISSUE-005、ISSUE-014
- Fixed-in commits：`21373af` `dba0fe3` `473486c` `d65d6d6` `7d25dba` `74e2e66`

> 修订纪要（2026-07-25）：原版误判:`getGeminiConfig()`/`getStepfunConfig()` 的
> `apiKey` **只从 DB `provider_credentials` 读取，没有任何 env 兜底**（这是
> AGENTS.md §7「不得明文 fallback」与契约测试 `config.test.ts:119`「never falls back
> to a plaintext credential env」**双锁的有意设计**）。因此「补 env 即可让 Director 跑」
> 的方案不成立。本版改成与 `provision-master-key.ts` 对称的 bootstrap 路径：
> 开发者把 key 临时写到 `.env.local`，bootstrap 一次性经真实 API 验证后写回 DB 加密存储，
> 运行时只读 DB，`.env.local` 仅为本地中转，**不参与运行时凭据解析**。

## 1. 症状

即使 pi 运行时修好（ISSUE-001），Director 仍会在两处抛错：

1. `src/features/render/vision-qa.ts:198-200`（已实现的唯一生产消费方）：

   ```text
   ${provider} API Key 未配置，无法执行 Vision QA
   ```

2. `src/features/director/pi-session.test.ts:415`（ISSUE-001 修复后会落回真实代码）：

   ```text
   Gemini API Key 未配置
   ```

两处都来自 `resolveDirectorModelTarget()` 返回的 `target.apiKey === null`。
原因：Next 应用进程没有任何 provider key 写入 DB `provider_credentials`。

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

### 2.2 Next 侧消费 `process.env` 的范围（关键事实）

`src/features/ai/gemini-config.ts:21-30`

```ts
const ENV_KEYS: Record<GeminiConfigField, string> = {
  baseUrl: 'GEMINI_BASE_URL',
  primaryModel: 'GEMINI_PRIMARY_MODEL',
  fastModel: 'GEMINI_FAST_MODEL',
}
const DEFAULTS: Record<GeminiConfigField, string> = { ... }
```

`src/features/ai/config.ts:64-70`

```ts
const ENV_KEYS: Record<StepfunModelField, string> = {
  baseUrl: 'STEPFUN_BASE_URL',
  chatModel: 'STEPFUN_CHAT_MODEL',
  ttsModel: 'STEPFUN_TTS_MODEL',
  asrModel: 'STEPFUN_ASR_MODEL',
  visionModel: 'STEPFUN_VISION_MODEL',
}
```

**`apiKey` 字段在两套 ENV_KEYS 中都缺席**——这意味着 env 路径只覆盖端点与模型名，
不覆盖凭据本身。`getGeminiConfig():62-68` 写的是 `apiKey: storedKey`，其中
`storedKey = deps.credentials.loadSecret(LOCAL_WORKSPACE_ID, 'gemini')`，**跑 DB 跑到
null 就是 null**，没有任何 `process.env.GEMINI_API_KEY` 兜底路径。
`src/features/ai/stepfun-adapter.ts:11` 的注释也明写「不回退 env」。

`server/.env` 只被 worker 的 `server/src/lib/load-env.ts` 加载，
Next 进程不会读它（issue §3 硬边界禁止让它读）。

### 2.3 凭据真值优先级本身是对的（但范围比原 issue 写的窄）

`src/features/ai/config.ts:77-92` 的解析顺序：

```text
DB 路由（provider_credentials / model_routes / media_routes）  >  process.env  >  代码默认值
```

**修正**：这套优先级只对 **端点 URL 与模型名** 三层生效（见 §2.2 ENV_KEYS 范围）。
**API Key 只有一层：DB `provider_credentials` 加密存储**（加密 key 来自
`CVC_CREDENTIAL_MASTER_KEY`，缺失即抛错，见 `credential-envelope.ts:45-48`）。

这同样是逐次调用实时读取，没有 import 期快照——所以「改了配置不影响后续 API 调用」
这个需求**已经天然满足**，无需改代码，也无需引入 YAML（§4）。

不对称之处仅在于：API Key **首次没有任何来源可用**——UI 写（`POST /api/settings`）
需要先有运行中的 Next + Postgres 才能写，而启动 Next 需要凭据时 DB 还是空的，
形成「鸡生蛋」依赖。Bootstrap 脚本正是用来打破这个冷启动循环的，不是替代运行时凭据路径。

## 3. 关键约束：不得与后端智能体耦合

`server/` 是另一套独立智能体（详见 `README.md` §0）。因此：

- **不要**让 Next 去读 `server/.env`（运行时与 bootstrap 都不允许）。
- **不要**改 `server/src/lib/load-env.ts` 让它向上回退到根目录。
- **不要**创建两套共用的 env 加载器或「统一配置层」。
- 两套各自拥有同名 `GEMINI_API_KEY`、各自命名 `STEP_API_KEY`（后端）/`STEPFUN_API_KEY`（前端）
  是**有意的隔离**，不是重复。Bootstrap **不读 `server/.env`**，只读根 `.env.local`；

  开发者若想让两套共用同一份 Gemini key 的真实值，需手动把 `server/.env` 里的
  `GEMINI_API_KEY` 的**值**复制到根 `.env.local` 的同名变量；StepFun 因前后端变量名不同，
  额外需把 `server/.env` 里 `STEP_API_KEY` 的值复制到根 `.env.local` 的 `STEPFUN_API_KEY`。
  文档（`docs/configuration/credentials.md`）必须明示这一手动复制步骤，并强调「各自存一份」
  是有意加固，不是疏漏。

## 4. 明确不引入 YAML

需求里提到「可以引入 yaml 或其他机制，让改配置不影响 API 调用」。经核实**不需要**：

1. 热更新已经实现（§2.3）——DB 路由逐次读取，无 import 期快照。
2. 现有真值层对模型与端点已是三层（DB > env > 默认）且有清晰优先级；
   再加 YAML 会成为**第四套真值**，直接违反 AGENTS.md「一个职责只有一个真值」
   与 routing.md §0 的真值顺序。
3. 真正缺的是「API Key 首次从哪来」——那是 DB 加密存储的冷启动问题，
   不是配置格式问题。Bootstrap 脚本与 `.env.local` 一次性中转已足够。

若未来确实需要文件化配置，必须先改 `AGENTS.md` 与 `docs/conventions/`，再落代码。本 issue 不做。

## 4.1 不做 env 兜底 API key（双向锁定）

行 AGENTS.md §7 的「凭据只存加密内容，master key 只从 server-only 环境读取，**不得明文 fallback**」，
本仓库已用两层测试锁死这一设计意图：

- `src/features/ai/config.test.ts:119-130` 标题即「uses model env values but never falls
  back to a plaintext credential env」——设置 `process.env.STEPFUN_API_KEY='env-key'` 后
  断言 `apiKey: null`。
- `src/features/ai/gemini-config.test.ts:93-118` 标题即「resolves encrypted credential/routes
  over env without exposing the key」——同样断言 `apiKey: 'stored-key'` 而非 env。

任何在 `getGeminiConfig()`/`getStepfunConfig()` 里追加 `process.env.X_API_KEY ?? storedKey`
的写法都将直接违反这两条契约测试，并且把「明文 fallback」引入前端进程——本 issue
**禁止**此改动；这是路径选择上的硬约束，与 §5「不改 `src/**`」一致。

## 5. 修复范围

| 文件 | 动作 |
| --- | --- |
| 根 `.env.local` | 开发者手动补齐 Next 侧 bootstrap 所需变量（**不提交**，`.gitignore` 已覆盖） |
| 根 `.env.example` | 删除 Next 侧零消费的 `STEP_API_KEY`；为 `GEMINI_API_KEY`/`STEPFUN_API_KEY` 加注释「仅 bootstrap 中转」；用注释分两段标注 server/ 与 Next 各自的 env 真值 |
| `tests/env.test.ts` | 同步移除 `STEP_API_KEY` 断言（Next 侧零消费）；保留 `GEMINI_API_KEY`/`STEPFUN_API_KEY` 占位断言 |
| `scripts/setup/bootstrap-credentials.ts` | **新增**，对称 `provision-master-key.ts`：读 `.env.local`、经真实 API 验证、写 DB 加密存储；不回显值 |
| `docs/configuration/credentials.md` | **新增**，说明「两套凭据独立」与 bootstrap + UI 双通道路径、安全约束 |
| `scripts/setup/README` | 提及 bootstrap 在初始化序列中的位置（在 `db-migrate` 之后、首次 `dev` 之前） |

Bootstrap 路径下，Next 侧在 `.env.local` 中所需登记的变量（值取自 `server/.env` 同名/映射同名，
但**复制到 `.env.local` 后即与 `server/.env` 解耦**）：

```text
CVC_CREDENTIAL_MASTER_KEY     已有，凭据加密 master key（32 字节 canonical base64）
DATABASE_URL / TEST_DATABASE_URL  已有
GEMINI_API_KEY                Director 默认 provider（7 个节点类型默认走 gemini）—— bootstrap 临时中转，运行时不读
GEMINI_BASE_URL               可留空用代码默认
GEMINI_PRIMARY_MODEL          可留空用代码默认 gemini-3.6-flash
GEMINI_FAST_MODEL             可留空用代码默认 gemini-3.1-flash-lite
STEPFUN_API_KEY               shot-sfx(TTS) 与 shot-subtitle(ASR) 默认走 stepfun—— bootstrap 临时中转，运行时不读
STEPFUN_BASE_URL / STEPFUN_CHAT_MODEL / STEPFUN_TTS_MODEL / STEPFUN_ASR_MODEL / STEPFUN_VISION_MODEL  可留空用默认
```

默认 provider 映射见 `src/features/ai/model-routing.ts:30-40`：
`shot-sfx` 与 `shot-subtitle` 默认 `stepfun`，其余 7 个节点类型默认 `gemini`。
因此**两个 key 都需要**（Gemini 与 StepFun），否则 ASSEMBLE 阶段会失败。

> 命名漂移修复说明：原 issue 列了 `STEP_API_KEY`/`STEP_BASE_URL`/`STEP_MODEL`/`STEP_VISION_MODEL`，
> 这四个是 `server/.env` 用的变量名（见 `server/.env.example:1-9`），**Next 侧零消费**
> （`src/features/ai/config.ts:64-70` 的 ENV_KEYS 用 `STEPFUN_*` 前缀）。原 issue
> 把后端那套变量名误抄进前端清单——本修订予以纠正。

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

1. `pnpm lint` / `pnpm typecheck` 通过，`pnpm test` 通过且 `tests/env.test.ts` 绿。
   修订后的 `tests/env.test.ts` 不再断言 Next 侧零消费的 `STEP_API_KEY=` 占位存在。
2. `.env.example` 的变量名与代码实际读取的键**逐一对应**，无漂移。
   保留项：`GEMINI_API_KEY`、`STEPFUN_API_KEY`（bootstrap 中转用，注释已明示）、
   `STEPFUN_*_MODEL` 与 `STEPFUN_BASE_URL`（代码 ENV_KEYS 中消费）、`GEMINI_*` 三项。
   删除项：`STEP_API_KEY`（Next 侧零消费，原本是 `server/.env.example` 的变量）。
   （历史上出过此类问题：`CAPTURE_DRIVER` 从未被代码读取，实读 `BROWSER_DRIVER`，
   见 `docs/reviews/qoder-architecture-cleanup-2026-07-25.md` F-05。）
3. **冷启动验证**：在一个干净的本地环境中，按 `docs/configuration/credentials.md`
   的步骤执行：
   1. `pnpm db:migrate`（已存在的 Postgres 已就绪）；
   2. 在根 `.env.local` 补 `GEMINI_API_KEY` 与 `STEPFUN_API_KEY`（值为 `server/.env`
      对应变量的副本，开发本地中转）；
   3. `pnpm tsx scripts/setup/bootstrap-credentials.ts`
      —— 脚本先经真实 API 验证（`validateGeminiKey` / `validateKey`）后写 DB 加密存储，
      失败不写并返回非 0 退出码；
   4. 然后在 Next 进程内（临时脚本或 `GET /api/settings`）验证 `getGeminiConfig().apiKey`
      与 `getStepfunConfig().apiKey` 都非空，且 `describeGeminiConfig()` /
      `describeStepfunConfig()` 只回 `configured/verifiedAt/updatedAt`，**不回显明文或密文**。
4. `POST /api/settings` 用**一个错误的 key** 提交，必须返回 **422** 且不覆盖已有值
   （routing.md §4.1 约定 3；现状已实现于 `src/app/api/settings/route.ts:67-76,105-113`，
   本项为回归确认）。
5. Bootstrap 自身必须遵守 §7 安全要求：只读 `.env.local`、不读 `server/.env`、
   校验失败不写 DB、输出只含 `configured/verifiedAt/updatedAt` 不含值、退出码非 0 时
   LLM/下一阶段无凭据可消费。
6. `git status --porcelain` 确认没有 `.env*` 被 stage。
7. 证据留档到 `docs/issues/evidence/issue-003/`（**只记录变量名与 present/absent，不记录值**）：
   - bootstrap 运行日志摘要（退出码 + 各 provider `configured=true`）；
   - `GET /api/settings` 响应切片只含 `configured/verifiedAt/updatedAt`；
   - 422 回归测试一次（用假 key，不展示值）；
   - 一份 `.env.example` 与 `src/features/ai/**` 的 ENV_KEYS 比对表（只列变量名）。

## 9. 备注

本 issue **不改 `src/**` 代码**——API key 的 DB-only 真值由契约测试与 AGENTS.md §7
双向锁定（§4.1）。修复只动 `docs/`、`scripts/`、`.env.example`、`tests/env.test.ts`：
修订 issue 自身漂移、补 bootstrap 脚本、产出凭据边界文档、同步配置占位文件。
是 ISSUE-001 第 7 项验收（真实运行证据）与 ISSUE-014 端测的前置条件。
建议第一批就完成，成本极低但解锁面很大。


## 多用户登录落地后的复核（2026-07-28 追加，不改写上方已核销内容）

- bootstrap 天然是**单 workspace 冷启动脚本**：PLAN-002 阶段 B 后业务侧
  save/validate 经 `currentWorkspaceId()` 取归属，`bootstrap-credentials.ts` 已改为在
  `runInAuthContext({ workspaceId: LOCAL_WORKSPACE_ID, userId: 'system:bootstrap' })`
  内执行——只写首个 owner workspace，其余用户经 `/products/settings` 自行写入。
- provider 凭据语义已拍板为**每用户自带 key**（不做平台统一 key、不跨 workspace
  fallback），详见 `docs/configuration/credentials.md` §3 的 Workspace boundary 段。
