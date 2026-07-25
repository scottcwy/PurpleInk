# ISSUE-001 交接总结

### 背景与范围

`docs/issues/` 只覆盖**前端画布 Director**（`src/features/director/**`），不碰 `server/**`。ISSUE-001 是 P0、**全链路的拱心石**——README §5 明确写着"第二批（ISSUE-001 是拱心石，先它）"，ISSUE-002/005/006 都排在它后面等它落地。

问题本质：Stage A 迁移时把历史 Pi 运行时整体摘除，接口契约、输出提取器、工具定义、提示词、artifact 门禁全部保留，只把"会话创建"与"会话持久化"两个实现替换成无条件抛错的壳（`NOT_AVAILABLE_STAGE_A`），并同步在 `vitest.config.ts` / `tsconfig.json` 里把对应的规格测试开洞排除，让 `pnpm test`/`pnpm typecheck` 全绿掩盖了运行时完全死掉的事实。

---

### 深度分析结论

| 点 | 结论 |
| --- | --- |
| 性质 | 不是设计缺陷，是**一次未完成的移植**；要补的是实现，不是重构架构 |
| 规格来源 | `pi-session.test.ts`（391 行/8 例）与 `session-store.test.ts`（81 行/3 例）已把预期行为写死，**不允许改测试迁就实现** |
| 版本选择 | 排除 `latest`（0.82.0，仅 1 天）；`0.80.10` 是唯一满足"发布满 7 天"供应链规则的版本 |
| API 一致性 | issue 原文只针对 0.82.0 做过核实，**0.80.10 的一致性是未完成项**，必须补做 |
| 门禁开洞范围 | `vitest.config.ts` 4 行 exclude + `tsconfig.json` 3 行 exclude，精确对应缺失的运行时 |

**决策**：不跳版本、不改测试、不动 `pi-output.ts`/`stage-runner.ts`/`prompts/**`/`schemas/**`/`tools/**` 等既有完好实现，只在 issue 划定的落点内补实现。

---

### 已落地改动（commit `847722d` + `4b621fe`）

**依赖**

- `pnpm add -w --save-exact @earendil-works/pi-agent-core@0.80.10 @earendil-works/pi-ai@0.80.10`（精确版本，不用 `^`/`~`/`latest`）
- 落地前在仓库外临时目录装了这个精确版本，读 `dist/**/*.d.ts` + 写探测脚本实跑（`Agent`、`AgentTool` 校验、`JsonlSessionStorage.create/open` + `Session.appendMessage/buildContext`、`createModels/createProvider/envApiKeyAuth`、`google-generative-ai.lazy`/`openai-completions.lazy`），确认与规格测试 mock 假设完全一致，**无版本偏离，不需要在文件里追加偏离记录**

**新建**

- `src/features/director/pi-provider.ts`（125 行）—— `DirectorModelTarget` → pi Provider/Model；gemini 剥掉配置面的 `/v1beta/openai/` 后缀走原生 `/v1beta`，stepfun 走 `openai-completions`；缺 Key 显式抛错不兜底
- `src/features/director/pi-tool-adapter.ts`（49 行）—— `DirectorTool` → pi 的 `AgentTool`；JSON Schema 直接交给 pi 校验器（pi 对无 TypeBox Kind 符号的纯 JSON Schema 有专门兼容路径），没有新增第二套 schema 真值
- `src/features/director/pi-messages.ts`（57 行）—— 消息投影与脱敏，`thinking` 落盘前过滤掉
- `src/features/director/pi-stream-bridge.ts`（64 行）—— `message_update` 前缀 diff → `streamBus.publish`；`message_end` → `appendMessage`

**改写**

- `src/features/director/pi-session.ts`（149 行）—— 用真实实现替换抛错壳，保持既有导出面不变
- `src/features/director/session-store.ts`（177 行）—— 构造签名改为 `constructor(storage: StorageAdapter)`；基于 `JsonlSessionStorage` 实现 `create`/`resume`/`close`；`storageKey` 恒为 `pi-sessions/` 前缀相对路径；`resume()` 校验前缀且路径解析后仍在 root 内才放行（路径穿越防护）

**删除**

- `tests/stage-a-unavailable.test.ts`（锁定的是"故意不可用"这一临时状态，与本 issue 目标直接冲突）

**门禁恢复（先文档后代码同批完成）**

- `vitest.config.ts`：删除 `pi-session.test.ts`、`session-store.test.ts` 两条 exclude（第 14–16 行归 ISSUE-006 的部分未动）
- `tsconfig.json`：同上，删除对应两条 exclude

**文档真值**

- `docs/issues/ISSUE-001-pi-agent-runtime.md`：状态 `open` → `done`，追加 §10 修复记录（版本核实方法、落地文件清单、验证结果、真实运行证据摘要）
- `docs/issues/README.md`：索引状态同步为 `done`

---

### 验证证据

| 命令/项 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | **98 files → 100 files**，433 passed；`pi-session.test.ts` 8 例、`session-store.test.ts` 3 例全绿，**未改一处断言** |
| `pnpm verify:v3` | 违规数未增，仍是 baseline 既有 2 条超行；`directOpenAiClientImports`=3、`canvasForbiddenImports`=15、`agentsSdk*`=0 均未超 debt cap |
| `pnpm build` | 成功 |
| grep `NOT_AVAILABLE_STAGE_A` | 全仓库无残留 |

**真实运行证据**（不是仅单测通过；`GEMINI_API_KEY` 经 `POST /api/settings` 真实 API 校验后写入 Postgres 加密存储，对一个真实项目真实触发 INGEST）：

- `POST /api/director/stage` → 200 + jobId；job 状态 `pending → running → done`
- `GET /api/director/stream/{nodeId}` SSE：收到 5 个真实 `delta` 增量事件 + `done`
- Postgres `artifacts` 表：`director-ingest`/`director-stream-log`/`pi-session` 三条记录，`content_hash` 与本机文件实际字节 SHA-256 核对一致
- Postgres `canvas_nodes` 表：`script-import` 节点 `status` 落 `succeeded`，`directorArtifactId` 指向 `director-ingest`，`directorError` 为空
- `pi-sessions/**.jsonl` 人工核对：**不含** `thinking` 内容、**不含** Gemini Key 明文（含 `AIza` 前缀专项检测）

证据文件：`docs/issues/evidence/issue-001/http-ingest-run.json`、`docs/issues/evidence/issue-001/sql-node-and-artifact-state.json`

---

### 未纳入本次 commit 的说明

- `.data/` 下的探测脚本（`pi-probe.mjs`、`issue-001-evidence.mjs` 等）是取证用的临时工具，`.data/` 已 gitignore，未进入任何 commit。
- `docs/issues/state-handoff.md` 是历史遗留的未 track 文件（ISSUE-007 交接记录），本次未触碰，仍显示为 `??`。

---

### 给下一位执行者

1. **下一块骨牌是 ISSUE-002**（`fabricate-render-seam`）。README §9 明确写着"ISSUE-001 交付后应立即解锁 ISSUE-002"：`fabricateShot()` 目前全仓库零调用方，即使 001 修好了，`shot-codegen` 阶段仍会在渲染队列入队时因缺 `director-fabricate` 产物失败。两者串起来才有第一个单镜 MP4。
2. **pi-session 相关文件已是最终态**，不要再拆分或改动导出面——`pi-session.ts`/`session-store.ts` 保持了原有对外契约，`pi-output.ts`/`stage-runner.ts`/`prompts/**`/`schemas/**`/`tools/**` 全程未动，禁区仍然有效。
3. **门禁共享文件已按行分配完毕**：`vitest.config.ts` 第 14–16 行、`tsconfig.json` 第 49 行的 `src/features/pipeline/contracts/**` exclude 归 ISSUE-006，不属于本次改动范围，勿误删。
4. **凭据写入面已验证可用**：`POST /api/settings` 写 Gemini Key 走真实 API 校验 + 加密存储，后续 issue 如需真实运行证据可复用同一路径，不必再单独打通。
5. **若需复验**：`git show 847722d`（实现）、`git show 4b621fe`（文档+证据）；grep `NOT_AVAILABLE_STAGE_A` 应全仓库零命中。


# ISSUE-003 任务完成总结与交接

## 一、任务完成总结

#### 1.1 Issue 概况

| 属性 | 值 |
| --- | --- |
| Issue | ISSUE-003 · Next 应用进程内无 AI 凭据，配置真值不对称 |
| 优先级 | P0（阻断） |
| 性质 | **纯配置 + 文档 + bootstrap 脚本，不改任何 `src/**` 代码** |
| 依赖 | 无，第一批可完全并行 |
| 阻塞下游 | ISSUE-001 第 7 项验收、ISSUE-002、ISSUE-005、ISSUE-014 |
| 状态 | `open` → `done`（7 次 conventional commit + 7 项 §8 验收全 PASS + 证据归档） |

#### 1.2 深度分析发现 issue 本身有结构性错误

原文 §5 主张「补 `.env.local` 即可让 Director 跑」——经代码核实**不成立**：

- `getGeminiConfig()` (gemini-config.ts:62-68) 与 `getStepfunConfig()` (config.ts:105-113) 的 `apiKey` **只从 DB `provider_credentials` 加密存储读取**，`ENV_KEYS` 中**没有** `*_API_KEY` 字段，无任何 env 兜底
- `stepfun-adapter.ts:11` 注释明写「不回退 env」，`gemini-config.ts:38-43` 同样只 `envOrDefault` URL/model 字段
- 这是 **AGENTS.md §7「不得明文 fallback」+ 两条契约测试**（`config.test.ts:119` "never falls back to a plaintext credential env"、`gemini-config.test.ts:93` "resolves encrypted credential/routes over env without exposing the key"）双锁的**有意设计**

此外发现 **§5 变量清单把 `STEP_API_KEY`/`STEP_BASE_URL`/`STEP_MODEL`/`STEP_VISION_MODEL` 误抄进前端清单**——这四个是 `server/.env.example:1-9` 的命名，Next 侧 `config.ts:64-70` 实读 `STEPFUN_*` 前缀。原 issue 把后端命名误推给前端。

#### 1.3 决策路径

放弃 issue 原方案，选**与 `provision-master-key.ts` 对称的 bootstrap 路径**：
- `.env.local` 仅作为**本地一次性中转**（临时承载 key 值）
- bootstrap 脚本经**真实 API 验证**两个 provider key（`validateGeminiKey` / `validateKey`）
- 验证通过才写 DB 加密存储（`saveGeminiApiKey` / `saveApiKey`）→ `provider_credentials` AES-256-GCM
- 写入后立即 `process.env[KEY]=''` 防护性清空、退出进程
- 运行时永远只读 DB，完全不读 env 中的 `*_API_KEY`

**严格不违反**：
- §5「不改 `src/**` 代码」（零 src 文件改动）
- AGENTS.md §7 master key 强制 + 不得明文 fallback
- 两条契约测试都不动
- 真值层次（DB > env > 默认）只覆盖 URL/model，apiKey 唯一来源仍是 DB

#### 1.4 已落地改动（7 次 commit，均在 master）

| SHA | scope | 文件 |
| --- | --- | --- |
| `21373af` | `docs(issues)` | `ISSUE-003-next-ai-credentials.md` 重写 §1/§2.2/§2.3/§4.1/§5/§8 |
| `dba0fe3` | `chore(config)` | `.env.example` 删 Next 侧零消费（STEP_API_KEY/LISTENHUB/IMAP/BROWSER_DRIVER 等）；`tests/env.test.ts` 同步 |
| `473486c` | `fix(config)` | 校正 `.env.example`：补回 `BACKEND_ORIGIN`（next.config.ts:30 实消费）、删误留的 `PORT`（仅 server 消费） |
| `d65d6d6` | `feat(setup)` | `scripts/setup/bootstrap-credentials.ts`（172 行）+ `server-only-stub.js`（空 stub） |
| `7d25dba` | `docs(configuration)` | `docs/configuration/credentials.md`（147 行，两套凭据边界文档） |
| `74e2e66` | `test(evidence)` | `docs/issues/evidence/issue-003/{README,evidence}.md` |
| `7245d44` | `docs(issues)` | 标记 ISSUE-003 `done` + README 索引同步（README 行被并发 commit `d09fc18` 并入） |

**新增文件 3 个**： bootstrap-credentials.ts、server-only-stub.js、credentials.md
**修改文件 2 个**： .env.example、tests/env.test.ts
**`src/**` 文件改动数: 0**（零触碰，严格守 §5 边界）

#### 1.5 验收证据（§8 全 7 项 PASS）

| # | 验收项 | 结果 |
| --- | --- | --- |
| 1 | `pnpm lint` / `pnpm typecheck` / `pnpm test` / `tests/env.test.ts` | 全 exit 0；`pnpm test` 100 files / 434 passed；`tests/env.test.ts` 3/3 |
| 2 | `.env.example` 与代码 ENV_KEYS 逐一对齐无漂移 | 4 present + 6 absent 全部通过（变量名比对表归档于 evidence.md） |
| 3 | Next 进程内 `get*Config().apiKey` 非空 + `describe*` 不回显明文 | 一次性 verify 脚本输出 `{"gemini":{"hasKey":true,"keyRevealPresent":false},"stepfun":{"hasKey":true,"keyRevealPresent":false}}` + `VERIFY=OK` |
| 4 | `POST /api/settings` 错 key 返回 422 不覆盖 | `route.ts:67-76,105-113` 审查 + bootstrap 孪生 validate-before-save 行为验证 |
| 5 | bootstrap 失败/未配置时非 0 退出、不打印 secret | bootstrap-credentials.ts:68-83 实跑 `written=2 skipped=0 failed=0`，输出仅 `[provider] configured (verifiedAt=now)` |
| 6 | `.env*` 均 not staged | `.gitignore` `/.env.example` 例外已生效；每次 commit 前 `git status --porcelain` 确认 |
| 7 | 证据留档（只变量名/存在性，无值） | `docs/issues/evidence/issue-003/evidence.md` 含 7 项 §8 矩阵 + 变量名对应表 + 6 个 commit SHA |

**bootstrap 实跑日志迹**（无值，只状态）：

```text
$ pnpm tsx scripts/setup/bootstrap-credentials.ts
[Gemini] validating via real API...
[Gemini] configured (verifiedAt=now)
[StepFun] validating via real API...
[StepFun] configured (verifiedAt=now)

[bootstrap-credentials] written=2 skipped=0 failed=0
```

**Postgres 实测**（无值）：

```text
 provider | verified | persisted | cipher_len 
----------+----------+-----------+------------
 gemini   | t        | t         |         53
 stepfun  | t        | t         |         65
(2 rows)
```

- `pnpm verify:v3`: `"ok": true, "violations": []`（`openai` 债务 3/3 命中使用，不引入新债务）
- bootstrap-credentials.ts **172 行**，远低于 250 行门禁；只 `import @next/env`、`drizzle-orm`、`@/features/ai/*`、`@/lib/db/*` 等已存在包；**不直接 import `openai`**

---

### 二、交接总结

#### 2.1 已完成且已 commit

- 全部 7 项 §8 验收 PASS，证据归档于 `docs/issues/evidence/issue-003/`
- 6 次 conventional commit 全部基于 master，未 push（无 remote）、未 amend、无 force
- **DB 加密存储状态**：本地 Postgres `provider_credentials` 已含 `gemini`/`stepfun` 两行 `verified=true`、`persisted=true`，cipher_len 非空——可直接被下游 issue 使用
- `.env.local` 现留有 `GEMINI_API_KEY` 与 `STEPFUN_API_KEY`（经 server/.env 值中转，无回显），运行时不消费，继续作为可重跑 bootstrap 的中转

#### 2.2 关键边界 & 禁区给下一位执行者

1. **API key 是 DB-only 真值**（AGENTS.md §7 + 双契约测试 + issue §4.1 三向锁定），**永不要**在 `getGeminiConfig()` / `getStepfunConfig()` 加 `process.env.X_API_KEY ?? storedKey` fallback——会同时打破契约测试、AGENTS.md §7 invariance、以及 make 假"运行时绿"
2. **bootstrap 是冷启动一次性**，不是运行时凭据路径；`pnpm dev` 运行时永远只读 DB
3. **前后端凭据隔离是故意的**（`docs/configuration/credentials.md` §1）：让前端各一份 Gemini/StepFun key 不是疏漏，设计上防裂。**禁止**做"共用 env 加载器/统一配置层"
4. **server-only stub** 只在 scripts/setup 进程中临时 patch `Module._resolveFilename`，不打扰 Next runtime；若你新增其他 setup 脚本引用 `src/lib/db/**` 或 `src/features/ai/**`，复用同一个 stub 模式
5. **轮换 CVC_CREDENTIAL_MASTER_KEY** 未自动化（stub-locked，需手动解密再加密）；当前未触动既有 envelope

#### 2.3 解锁关系（可直接开工的下游 issue）

- **ISSUE-001 第 7 项验收**（Director 真实运行证据）：现可冷启动 playwright 驱动六阶段，nodeType → provider 的 `apiKey` 已非空，不再抛 `'Gemini API Key 未配置'` 与 `'StepFun API Key 未配置'`
- **ISSUE-002**（FABRICATE→render 接缝）：`vision-qa.ts:198-200` 在 `target.apiKey === null` 时抛错路径现在可达非空
- **ISSUE-005**（audio timing）：依赖 ISSUE-001 + 002 实跑，本 issue 解锁其前置
- **ISSUE-014**（端测证据）：冷启动序列 `pnpm db:migrate` → `pnpm tsx scripts/setup/bootstrap-credentials.ts` → `pnpm dev` 可写入端测 fixture
- **ISSUE-011**（设置页占位）：并发数已可由设置页读写（issue-004 已落），本 issue 的凭据边界文档补全了另一面

#### 2.4 关键决策路径（供审计回溯）

| 决策点 | 选择 | 理由 |
| --- | --- | --- |
| 是否在 `get*Config` 加 env fallback | **否** | 双契约测试 + AGENTS.md §7 三向锁定，违反即破契约 |
| 是否走 UI 手动写 key | **否** | 鸡生蛋：启动 Next 需凭据 → DB 空 → 无法启动 |
| bootstrap 路径 vs YAML | **bootstrap 脚本** | 不引入第四套真值，与 `provision-master-key.ts` 对称 |
| `.env.local` 角色 | **一次性中转**，非运行时凭据路径 | 既是 §3 隔离边界硬约束，也是 §4.1 不引入明文 fallback 的延伸 |
| 修订 issue 自身 vs 只改代码不修订 | **修订** | 不修订会让后续执行者照原文方案犯错，出非运行的假绿 |

#### 2.5 接手人快速验证清单

```powershell
# 复验门禁
pnpm lint
pnpm typecheck
pnpm test
pnpm verify:v3
git diff --check

# 复验 bootstrap 真可跑（假设 server/.env 已填）
pnpm tsx scripts/setup/bootstrap-credentials.ts
docker exec purpleink-dev-postgres-1 psql -U cvc -d cvc -c `
  "SELECT provider, verified_at IS NOT NULL AS verified, updated_at IS NOT NULL AS persisted FROM provider_credentials ORDER BY provider;"

# 复验 apiKey 真非空 + 不回显
pnpm tsx scripts/setup/bootstrap-credentials.ts  # 已写过的不会重复覆盖
# 临时脚本模式见 evidence.md「One-shot verify run summary」段

# 看 6 个 commit 的真实内容
git show 21373af dba0fe3 473486c d65d6d6 7d25dba 74e2e66 7245d44 --stat
```

#### 2.6 未纳入本 issue 的观察（非遗漏，记录给后续）

- `AGENTS.md` 仓库当前有并发未 commit 改动（其他代理 ISSUE-004/007/009/010/013 同步在动），本次提交夹带了无独有偶的并发痕迹（commit `7245d44` 文档说改了 README 行，实际 README 行修改被并发 commit `d09fc18` 在我 push 之前的状态里并入了——结果一致，evidence.md 已如实记录）
- `docs/configuration/tts.md:62` 写「repository-level `.env.example` intentionally contains no TTS settings」，但 `tests/env.test.ts` 旧锁了 `LISTENHUB_API_KEY=` 在 `.env.example` 存在——**这是 issue 之前就漂移但未在我打开 TASK 时发现** 的 issue；本 issue 顺手清掉了 LISTENHUB 这条漂移占位，但 `tts.md` 文档不动（避免越界）
- **轮换 CVC_CREDENTIAL_MASTER_KEY 仍是手动操作**：bootstrap 完成 + master key 已知，这就够冷启动用；若后续要做轮换自动化，需在 scripts/setup 增解密+重加密脚本（超出本 issue 范围，不在 §5 改动清单内）
- 若要在白盘/CI 环境复现冷启动验证，**需要先注入自己的真实 GEMINI_API_KEY / STEPFUN_API_KEY 到 .env.local**，否则 bootstrap 退出 2（这是设计预期，不是缺陷）

---

**总结一句**： 本 issue 真正缺的不是「把 key 加到 env」，而是「把 key 从 bootstrap 安全送进 DB 加密存储 + 把 issue 文档自身从假前提改回真前提」。前者沿 `provision-master-key.ts` 对称路径实现（零 src 改动），后者修订了 issue 自身以阻止下游沿用错误方案。

# ISSUE-004 交接总结

### 背景与范围

`docs/issues/` 只覆盖**前端画布 Director**（`src/features/director/**`），不碰 `server/**`。ISSUE-004 属 **P1、第一批可并行**，范围严格限定 `src/lib/queue/**`，与 P0（001–003）文件零重叠。

问题本质：进程内队列用**单一全局并发数字**混用两类负载性质完全不同的作业——`director-stage`（LLM I/O 密集，实测 16 路并发零限流）与 `render-shot`（Chromium + ffmpeg，CPU/内存密集）。调高并发让渲染 OOM，调低并发让 LLM 阶段被无谓串行化；且 `claim()` 只按 `createdAt` 取最老一条、与 kind 无关，队首一个长渲染会阻塞后面所有可并行的 LLM 阶段（队头阻塞）。

---

### 深度分析结论

| 点 | 结论 |
| --- | --- |
| 诊断 | issue 原文证据全部核实成立（`in-process-queue.ts:21/64/99-108`、`init.ts:36`） |
| issue 伪代码的缺口 | 伪代码没定义"lane 集合从哪来"。若照抄成"只遍历 `handlers.keys()` 精确 claim"，会让「入队了但没注册 handler」的 kind 永远拿不到 claim() 机会，从"立即失败"退化成"永远卡在 queued"——正好打破现有测试 `records a stable failure when no handler is registered` 的契约 |
| 解决方案 | 精确 lane（`taskId = 'legacy.<kind>'`）+ 一个固定配额 1 的**共享**兜底通道（`NOT IN` 排除已知 kind），而不是给每个未知 kind 各自开一条独立配额通道 |
| 兜底通道为什么选"共享一个槽位"而不是"每个未知 kind 各自 1 个" | 生产代码里只有 2 个真实 kind 会入队；走兜底通道的只有测试夹具与"忘记登记配额"这种防御场景。"每个未知 kind 独立发现"需要每 200ms 多一次 `DISTINCT` 查询、且 running Map 会为用过一次的陌生 kind 无限增长，成本换不来收益，也超出 issue 原文"未登记 kind 兜底为 1"这句话本身的要求 |
| 配置来源 | 仅 env 覆盖（`CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY` / `CVC_QUEUE_RENDER_SHOT_CONCURRENCY`），非正整数直接 throw，不静默回退；DB 配置留给 ISSUE-011 |

---

### 已落地改动（commit `97b741e`——**注意：提交信息写错了**，见下方「已知问题」）

**`src/lib/queue/in-process-queue.ts`**
- `running: number` → `running: Map<string, number>`，按 lane key 计数
- `start(lanes?: LaneQuotas)`：`resolveLanes()` 合并默认值（`director-stage: 12`、`render-shot: max(1, floor(cpus/2))`）与调用方覆盖，`isPositiveInteger()` 校验，非法值直接 throw
- `claim(filter)`：`{kind}` 精确匹配 `taskId = 'legacy.<kind>'`；`{excludeKinds}` 用于兜底通道，`LIKE 'legacy.%' AND NOT IN (...)`
- `tick()`：`Promise.all` 并行 drain 所有 lane（含兜底通道），避免任何一个 lane 的领取循环阻塞其他 lane
- 导出 `isPositiveInteger`、`DEFAULT_DIRECTOR_STAGE_CONCURRENCY`、`defaultRenderShotConcurrency`，供 `init.ts` 复用校验规则，避免同一条"必须是正整数"规则在两处漂移

**`src/lib/queue/types.ts`**：`QueueAdapter.start(concurrency?: number)` → `start(lanes?: LaneQuotas)`，新增 `LaneQuotas = Partial<Record<string, number>>`

**`src/lib/queue/init.ts`**：新增 `resolveLaneQuotas(env?)` 读取两个 env key 并校验，`queue.start(resolveLaneQuotas())` 取代无参调用

**`src/lib/queue/index.ts`**：导出 `LaneQuotas` 类型

**测试**：
- `in-process-queue.pg.test.ts` 补 4 个用例：独立配额隔离、**队头阻塞回归**（render-shot 卡住时 director-stage 仍能跑完——issue 要修的核心 bug 的直接证据）、未登记 kind 并发=1、非法配额拒绝；原有 3 处 `queue.start(1)` 改造为按 lane 传参
- `init.test.ts` 补 3 个用例：`resolveLaneQuotas` 默认值/env 覆盖/非法值拒绝

**`/simplify` 四路 review 后应用的 2 处修复**：`claim()` 里一个永远走不到的死分支（`excludeKinds` 结构上不可能为空数组）；`tick()` 从顺序 `await` 改 `Promise.all`（否则 director-stage 配额打满时会在拿到自己的槽位前先排空整个 for 循环才轮到 render-shot 开始 claim，等于在 tick 粒度重新引入弱化版队头问题）

**未动（禁区）**：`server/**`；`enqueue`/`register` 语义；`queueFingerprint` 算法；`pipeline_runs`/`task_attempts` 表结构。

---

### 验证证据

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 432/433（唯一失败是 `renderer.integration.test.ts` 的 Chromium CDP 截图偶发失败，与队列改动无关，单独重跑已通过，确认环境 flake） |
| `pnpm test:pg` | 76/76 全绿，含新增的 8 个队列用例 |
| `pnpm verify:v3` | 违规数未增加（现存违规均来自其他并发会话的未提交改动，见下方「已知问题」） |

---

### 已知问题：并发会话导致的提交信息错位（需要人工介入）

这个仓库当前有**另一个并发会话在同时操作**（同一用户 `AIMFllys`）。经过：

1. 我 `git add` 了 6 个 ISSUE-004 队列文件准备提交；
2. 与此同时另一个会话把 `docs/issues/ISSUE-013-ai-adapter-boundary.md` 也 add 进了共享暂存区；
3. 我 `git restore --staged` 把 ISSUE-013.md 移出暂存区（只保留我的 6 个文件）；
4. 几乎同时，那个会话执行了它自己的 `git commit`——但那一刻共享暂存区里已经没有它的文件了，只有我的 6 个队列文件。

**结果**：提交 `97b741e` 的**内容 100% 是本次 ISSUE-004 队列改动**（6 个文件、318 行插入，与本次修复完全吻合），但**提交信息写的是「docs(issues): record ISSUE-013 step-1 adapter boundary findings...未改任何代码」**——文不对题，完全没提 ISSUE-004。

用户已确认**不 amend**，保持原样，仅在此记录说明。真正的 ISSUE-013 内容（`ISSUE-013-ai-adapter-boundary.md` 的修改）**没有丢失**，仍完好留在工作区（unstaged 状态），需要那个会话自己重新 `git add` + `commit`。

**给下一位执行者 / 那个并发会话**：
- 如果你是 ISSUE-013 那个会话：你的 `ISSUE-013-ai-adapter-boundary.md` 改动还在工作区，没有提交，请重新 commit。
- 如果你要查 ISSUE-004 的提交，用 `git show 97b741e -- src/lib/queue` 看内容，**不要被提交信息误导**。
- 多个会话同时在同一工作区跑 git 有真实竞争风险（本次亲历），后续并行 issue 建议各自开 worktree 或至少在 commit 前确认 `git status` 只包含自己的文件。

---

### 未完成事项（issue 自身已声明的延后项，不是遗漏）

issue 验收标准 §3「真实并发证据」（起一个 ≥6 unit 的项目、实测扇出后的真实并行数）**依赖 ISSUE-001 + ISSUE-002 + ISSUE-003 先落地**——这在 issue 自己的 §7 备注里写明是延后项。目前这三个 P0 状态未知（需查 `docs/issues/README.md` 最新状态），本次未杜撰或跳过这项验证，如实标注为阻塞中。待 P0 就绪后，接手人应：
1. 起一个 ≥6 script unit 的项目，一键启动；
2. SQL 查询确认扇出后同时 `running` 的 `director-stage` 节点数达到配额上限，且 `render-shot` 并行数不超过 `cpus/2`；
3. 记录墙钟对比（与修复前单一并发对比）；
4. 证据留档到 `docs/issues/evidence/issue-004/`（当前该目录不存在，因为还没有可留的真实证据——不要在证据不存在时创建空目录充数）。

---

### 给下一位执行者

1. **队列并发已按 kind 拆分**：`director-stage: 12`、`render-shot: max(1, floor(cpus/2))`，可用 `CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY` / `CVC_QUEUE_RENDER_SHOT_CONCURRENCY` 覆盖；未登记 kind 固定并发 1（共享兜底通道，非各自独立）。
2. **ISSUE-011 现在可以开工**：依赖的"真实可配并发数"基础设施已就位（`LaneQuotas` 类型 + `resolveLaneQuotas` 模式），UI 只需在其基础上接一层设置页读写。
3. **不要在 `in-process-queue.ts` 之外再重复一遍"正整数校验"规则**——已导出 `isPositiveInteger()`，`init.ts` 已在用；ISSUE-011 的 API 层校验也应导入它，不要重写。
4. **若需复验本次改动**：`git show 97b741e -- src/lib/queue`；`pnpm test:pg -- in-process-queue.pg.test.ts` 重跑 8 个用例（含队头阻塞回归测试）。

# ISSUE-007 交接总结

### 背景与范围

`docs/issues/` 只覆盖**前端画布 Director**（`src/features/director/**`），不碰 `server/**`。ISSUE-007 属 **P2、第一批可并行**，与 P0（001–003）文件零重叠。

问题本质：`@xyflow/react` 有两套实现——生产用 `CanvasView`，playbook 用 `WorkflowCanvas`——两套状态枚举、两套节点视觉，但**无运行时冲突**（后者只挂 `/playbook/patterns`）。

---

### 深度分析结论

| 点 | 结论 |
| --- | --- |
| 性质 | 不是双生产画布，是「生产画布 + 过期 fixture 整图样例」 |
| 违规 | 裸 disabled 按钮；文案引用 §12 已作废的 `ProductFlowVersion`/`FlowNode` |
| 方案 C | **排除**：`Design-system-inventory.md` 只登记 `PipelineNode/Canonical`，无整图样例要求 |
| `PipelineNode` | **保留**：有独立 demo + `/playbook/ui` 登记，不是 WorkflowCanvas 专属 |
| patterns 清空 | 若只删条目会留空分类，违反验收「禁止空分类占位」 |

**决策（你确认）**：方案 A + **整体删除** `patterns` 分类与 `/playbook/patterns` 路由。

验收口径修正：`PipelineNodeStatus` 可留在 `pipeline-node.tsx`；零命中只要求 workflow fixture（`STAGE_B_WORKFLOW_NODES` 等）。

---

### 已落地改动（commit `cfcc52a`）

**删除**

- `src/features/workflow/{workflow-canvas.tsx, workflow-canvas.demo.tsx, blueprint-model.ts}`（含目录）
- `src/app/playbook/patterns/page.tsx`（含目录）

**代码/测试**

- `registry.ts`：`PlaybookCategory` → `"ui" | "icons"`，去掉 WorkflowCanvas
- `playbook/page.tsx`：去掉 Patterns 卡片
- `registry.test.ts`：去掉 patterns 断言
- `app-route-contract.test.tsx`：去掉 blueprint import/断言；`RETIRED_PATHS` 加入 `playbook/patterns`、`features/workflow`

**文档真值（先文档后代码）**

- `routing.md` §2.4 / §2.5 / §11 相关说明
- ISSUE-007 → `done` + §0 决策记录；`docs/issues/README.md` 同步
- `src/app/README.md` 目录与接线表

**未动（禁区）**：`canvas-view.tsx`、`flow-elements.tsx`、`components/ui/node/**`、`pipeline-node.tsx`。

---

### 验证证据

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 98 files / 410 passed |
| `pnpm build` | 成功；路由表无 `/playbook/patterns` |
| `pnpm verify:v3` | 仍仅 baseline 2 条超行（未新增） |
| Chromium | `/playbook` 三卡（Foundations/UI/Icons）；`/playbook/patterns` → 诚实 404；`/playbook/ui` 仍有 PipelineNode |

---

### 未纳入本次 commit 的工作区改动

下列**不是** ISSUE-007，提交时已刻意排除（偏 ISSUE-003/004）：

- `.env.example`、`package.json`、`pnpm-lock.yaml`
- `src/lib/queue/**`、`tests/env.test.ts`

接手人应单独处理，勿与画布删除混 commit。

---

### 给下一位执行者

1. **生产画布唯一真值**：`CanvasView` + `components/ui/node/**` + `NodeStatus`；不要再引入第二套 workflow fixture 画布。
2. **`patterns` 已退役**：`RETIRED_PATHS` 与 routing §2.5 锁死，勿恢复空分类。
3. **下一并行候选**（文件仍不重叠）：ISSUE-009 / 010；P0 拱心石仍是 ISSUE-001。
4. **若需复验**：`git show cfcc52a`；grep `WorkflowCanvas|STAGE_B_WORKFLOW_NODES|features/workflow` 应仅剩文档历史引用。

# ISSUE-009 任务完成总结与交接

## 一、任务完成总结

### 1.1 Issue 概况

| 属性 | 值 |
| --- | --- |
| Issue | ISSUE-009 · routing.md §11 收敛清单未清 |
| 优先级 | P2（其中编码项实为安全/正确性问题） |
| 性质 | 清单式修复，5 个已登记收敛点 |
| 依赖 | 无，可第一批并行 |
| Commit | `94af7d3` · 34 files changed, 195 insertions(+), 60 deletions(-) |

### 1.2 五个收敛点修复详情

**2.1 artifact href 未编码 `projectId`（正确性 + 安全）**

| 文件 | 改动 |
| --- | --- |
| `canvas-inspector.tsx:263` | `artifact.id` 和 `projectId` 双方 `encodeURIComponent` |
| `api.ts:76` `videoUrl(id)` | 加 `encodeURIComponent(id)` |
| `use-stage-stream.ts:65` | 核查通过，已正确编码，无需改动 |
| `tests/url-encoding-contract.test.ts` | 新增 4 个测试用例，覆盖三条 URL 合同，断言 `%2F` |

**2.2 `robots.ts` 缺 `/share/` disallow**

`disallow: ["/api/", "/private/"]` → `disallow: ["/api/", "/private/", "/share/"]`。防御性配置，不依赖 `/share/[shareId]` 路由存在。

**2.3 `sitemap.ts` 只有一条**

选择「结构就绪 + 注释」方案。在 `sitemap.ts` 加注释指向 `routing.md` §3 与 §8，说明待 `ShareSnapshot` 落盘后接入。不编造假数据，不标 `blocked`。

**2.4 `empty-state.tsx` 历史 token 未收敛**

`text-label-secondary/tertiary` → `text-ds-text-muted`（依据 `Design-system-inventory.md` §4.1 映射）。同步修复 `src/components/ui/**` 内全部 5 个文件的历史 token：

- `empty-state.tsx`（3 处）
- `node/export-node.tsx`（2 处）
- `node/shot-node.tsx`（4 处）
- `resize-handle.demo.tsx`（2 处）
- `tooltip.demo.tsx`（1 处）

**2.5 `font-sc` 空类名**

全仓库 37 处 `font-sc` 全部删除。CSS 中从未定义（`globals.css`、`design-system.css`、Tailwind 配置均无），删除无行为变化。涉及 20 个源文件。

### 1.3 文档同步

| 文件 | 改动 |
| --- | --- |
| `docs/conventions/routing.md` | §4.3 更新违规描述为已修复；§11 表格加状态列，4 项标 ✅，1 项标 ⏳ |
| `docs/issues/ISSUE-009-routing-convergence.md` | 新增 §5 sitemap 方案决策 |
| `src/app/README.md` | §8 已知问题列表标注 2/4/7 项已修复 |
| `docs/issues/evidence/issue-009/README.md` | 新增，含完整修改清单和验收对照表 |

### 1.4 验证结果

| 验证项 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 100 files / 434 passed / 0 skipped，exit 0 |
| `pnpm verify:v3` | `"ok": true, "violations": []`，exit 0 |
| `pnpm build` | 成功，`/robots.txt` 与 `/sitemap.xml` 在路由列表 |
| `src/components/ui/**` grep `text-label-secondary/tertiary` | 0 命中 |
| 全仓库 grep `font-sc`（代码） | 0 命中 |

---

## 二、交接总结

### 2.1 已完成且已 commit 的内容

全部 5 个收敛点已修复、已验证、已 commit（`94af7d3`）。验收标准 1-4、7-8 已满足。

### 2.2 待运行时验证的事项（验收标准 5-6）

以下两项需要启动 `pnpm dev` 后验证，本次未执行：

1. **`curl` 验证 `/robots.txt` 与 `/sitemap.xml`**
   - `curl http://localhost:3000/robots.txt` 确认含 `Disallow: /share/`
   - `curl http://localhost:3000/sitemap.xml` 确认只有 `/` 一条
   - `pnpm build` 输出已确认两个路由存在且为 Static prerender

2. **4 个边界页 Chromium 截图回归**
   - `not-found.tsx`（根级）、`products/(app)/not-found.tsx`（段级）、`products/(app)/error.tsx`、`global-error.tsx`
   - token 从 `text-label-secondary/tertiary`（带透明度的 RGBA）替换为 `ds-text-muted`（实色），浅色模式下会略深，这是 token 体系收敛的预期效果
   - `global-error.tsx` 不使用 `EmptyState`，不受本次改动影响

### 2.3 sitemap 后续接入条件

`sitemap.ts` 当前只有 `/` 一条。`/artifacts` 与 featured 案例需等 `ShareSnapshot` 模型落盘后接入。接入时需：

1. 从 `ShareSnapshot` 查询 `visibility = featured` 的记录
2. 为每条生成 `/artifacts/[caseSlug]` 条目
3. 加 `/artifacts` 列表页本身
4. 不得编造假案例或硬编码 slug

### 2.4 对其他 Issue 的影响

- **ISSUE-010**（超行文件）：本次删除 `font-sc` 略微减少了 `export-workspace.tsx` 和 `export-review.tsx` 的行数，但不影响其超限状态
- **ISSUE-001/006**（门禁洞）：本次未触碰 `vitest.config.ts` 或 `tsconfig.json` 的 exclude 列表
- **ISSUE-013**（AI 适配器）：本次未增加 `openai` import，`verify:v3` 的 3 处债务上限不变

### 2.5 未纳入本 issue 范围的相关发现

- `src/components/icons/lucide-catalog.demo.tsx` 有 1 处 `text-label-secondary`，不在 `src/components/ui/**` 内，不在本 issue 范围
- `robots.ts` 仍保留不存在的 `/private/` disallow——issue 未要求删除，且保留无害
- `routing.md` §3 表格中 robots 规则描述仍写「当前 `allow: /`、`disallow: /api/`、`/private/`。新增 `/share/` 到 disallow」——可考虑后续更新为已完成的现状描述

# ISSUE-010 交接总结

### 背景与范围

`docs/issues/` 只覆盖**前端画布 Director 工作流**，不碰 `server/**`。ISSUE-010 属 **P2、第一批可并行**，性质是纯结构拆分，目标是消除两个生产文件的硬上限违规：

- `src/app/products/(app)/shots/[shotId]/shot-detail.tsx`：525 行；
- `src/app/products/(app)/export/[projectId]/export-workspace.tsx`：389 行。

问题直接导致 `pnpm verify:v3` 恒定 exit 1，两条违规均为 `OVERSIZED_NEW_FILE`。长期恒红会让 architecture gate 失去诊断价值，后续真正新增的架构违规容易被已有红项淹没。

本次范围严格限定：

- 两个超限入口文件；
- 按真实职责拆出的兄弟文件；
- `export-view-model.ts` 及其测试；
- architecture baseline；
- `AGENTS.md` 已知债务说明；
- ISSUE-010 状态与浏览器证据。

**未修改**：

- `server/**`；
- 路由；
- API 契约；
- 数据库 schema；
- 渲染、导出或播放器业务逻辑；
- 共享 UI 原语；
- Director/provider/queue 实现；
- 其他 Issue 的工作区改动。

---

### 深度分析结论

| 点 | 结论 |
| --- | --- |
| 诊断 | ISSUE 原文两条超限证据全部复现：`export-workspace.tsx` 389 行、`shot-detail.tsx` 525 行 |
| `shot-detail.tsx` 根因 | 同时承担页面编排、分镜代码读取、渲染状态、视频播放器、逐帧控制、缩略图轨道、代码面板和合同面板，具有至少 6 个独立变化原因 |
| `export-workspace.tsx` 根因 | 同时承担页面编排、readiness 加载、导出状态、分辨率乐观更新、预览、时间线、响应式设置面板和 Final QA |
| baseline 根因 | baseline 仍登记路由迁移前的 `src/app/legacy/**` 路径；当前 `/products/*` 路径未登记，因此被正确识别为新的超限文件 |
| 不合格方案 | 排除 `part2.tsx` 机械搬运、纯 re-export 壳、一次性匿名小组件堆叠、`utils.ts` 大杂烩，以及把当前路径重新登记进 baseline |
| 分镜方案 | 页面入口只做组合；运行状态进入 `use-shot-runtime.ts`；播放器进入 `shot-player.tsx`；代码与合同展示进入 `shot-detail-panels.tsx` |
| 导出方案 | 页面入口只做组合、预览与时间线；状态进入 `use-export-runtime.ts`；响应式设置与 QA 进入 `export-review.tsx`；纯映射进入既有 `export-view-model.ts` |
| `shot-panels.tsx` | 刻意不继续塞入代码/合同展示，避免这个已有 230 行左右的容器文件成为下一项超限债务 |
| 行为边界 | 所有文案、DOM 顺序、Tailwind class、effect 依赖、localStorage key、错误回退、API 参数和 `router.refresh()` 条件均保持原样 |
| 浏览器验收策略 | 因同期并行任务修改了共享 UI 字体 class，普通前后截图会被污染；最终改用两个 detached commit 的受控 Chromium 环境比较 |
| 最终结果 | 两个入口分别降至 144/107 行，所有新增生产文件均不超过 234 行，`verify:v3` 违规为空 |

---

### 设计与实施计划

本次在生产代码前先完成并提交了设计与实施计划。

**设计规格：commit `c560044`**

```text
docs(superpowers/specs):
docs/superpowers/specs/2026-07-25-issue-010-oversized-files-design.md
```

设计规格锁定：

- 真实职责边界；
- 非目标与禁区；
- 数据流；
- 行为等价策略；
- 文件规模目标；
- 浏览器前后证据要求；
- 分阶段提交边界。

**实施计划：commit `b1a1669`**

```text
docs/superpowers/plans/2026-07-25-issue-010-oversized-files.md
```

实施计划按以下阶段执行：

1. 复现 architecture 红项并留存浏览器基线；
2. 拆分分镜详情；
3. 以 TDD 拆分导出工作区；
4. 清理 baseline、更新 Issue、全量验证并留存前后截图。

---

### 已落地改动：分镜详情（commit `7ae6b26`）

#### `shot-detail.tsx`

从 525 行降至 144 行。

现在唯一职责是：

- 组合页面 TopBar；
- 上一镜、下一镜导航；
- 重渲与 MP4 下载入口；
- `usePublishNavContext`；
- 连接播放器、代码面板和合同面板。

没有改变：

- 页面 props；
- TopBar 文案；
- 状态徽章判断；
- 下载链接；
- 重渲入口；
- 上一镜/下一镜 href；
- 子组件 props。

#### 新增 `use-shot-runtime.ts`

最终 73 行。

唯一职责：

- 读取 `previewUrl` 对应的分镜 HTML；
- 管理 `rendering`、`outputUrl`、`sourceCode`、`codeLoading`、`codeError`、`error`；
- 调用既有 `renderShotAndWait()`；
- 接收真实 `artifactUrl`；
- 成功后调用 `router.refresh()`；
- 保留原有中文错误回退。

保留的关键行为：

```text
分镜代码读取失败
单镜渲染失败
分镜代码尚未生成
```

没有新增第二套 API 请求实现，继续复用 `shot-api.ts`。

#### 新增 `shot-player.tsx`

最终 188 行。

唯一职责：

- `<video>` / `<iframe>` / 空态三分支；
- 播放、暂停；
- 上一帧、下一帧；
- 当前时间与总时长；
- 进度条；
- 缩略图异步加载；
- 缩略图 Skeleton、失败态和活动帧高亮；
- 播放器错误 Toast。

保留：

- `THUMBNAIL_COUNT = 8`；
- `fetchThumbnails()`；
- `activeThumbIndex()`；
- `formatTimecode()`；
- `stepFrame()`；
- iframe `sandbox="allow-scripts"`；
- 原有 video events 与 effect 依赖。

#### 新增 `shot-detail-panels.tsx`

最终 109 行。

唯一职责：

- `ShotCode`；
- 私有 `codeSyncLabel()`；
- `ShotContract`。

保留的同步状态：

```text
渲染中
加载中
读取失败
已同步
待生成
```

保留的合同字段：

- 分镜编号；
- 构图模式；
- 分辨率；
- 字幕；
- 确定性验证状态。

#### 未动

- `shot-api.ts`；
- `shot-server-data.ts`；
- `shot-panels.tsx` 的折叠、Drawer 和 resize 逻辑；
- `page.tsx` 服务端数据装配；
- Artifact 查询；
- render API；
- `server/**`。

---

### 已落地改动：导出工作区（commit `978d463`）

#### `export-workspace.tsx`

从 389 行降至 107 行。

现在唯一职责是：

- 页面级组合；
- TopBar；
- 成片预览；
- 时间线；
- 导出评审区域接线；
- `usePublishNavContext`。

保留：

- `disabled = !readiness?.ready || exporting`；
- TopBar 导出按钮；
- `ExportPreview`；
- `ExportTimeline`；
- 四条时间线轨道；
- 原有传入 `ExportReview` 的 props。

#### 新增 `use-export-runtime.ts`

最终 52 行。

唯一职责：

- 初次加载 `ExportReadiness`；
- 回填已有 `artifactUrl`；
- 管理导出状态；
- 调用 `startProjectExport()`；
- 管理分辨率乐观更新；
- PATCH 失败后重新加载 readiness；
- 保留原有错误回退。

没有修改：

- API URL；
- HTTP method；
- 请求体；
- 乐观更新时序；
- 失败回拉逻辑；
- 用户可见错误文案。

#### 新增 `export-review.tsx`

提交时最终 234 行。

唯一职责：

- 响应式设置面板；
- 折叠/展开；
- Drawer；
- resize；
- 分辨率选择；
- 帧率、格式和字幕烧录展示；
- 导出队列状态；
- Final QA；
- 未完成节点展示。

保留的关键配置：

```text
cvc:export-settings-collapsed
cvc:export-settings-width
```

保留：

- `BP_SECONDARY_PANEL_COLLAPSE`；
- `EXPORT_SETTINGS_DEFAULT_WIDTH`；
- `EXPORT_SETTINGS_MIN_WIDTH`；
- `EXPORT_SETTINGS_MAX_WIDTH`；
- `TRANSITION_BASE`；
- `TRANSITION_INSTANT`；
- 原有 Drawer 方向与 aria-label；
- 原有 UI 文案与组件顺序。

#### `export-view-model.ts`

最终 50 行。

新增纯函数：

```ts
buildResolutionOptions()
```

输出：

```ts
[
  { value: '1080x1920', label: '高清' },
  { value: '720x1280', label: '标清' },
  { value: '540x960', label: '流畅' },
]
```

继续保留：

- `buildShotClips()`；
- `fullTrackClip()`；
- 真实 lane 数量驱动的时间线投影。

---

### TDD 证据

导出分辨率映射严格按 RED → GREEN 实施。

#### RED

先修改：

```text
src/app/products/(app)/export/[projectId]/export-view-model.test.ts
```

新增：

```ts
expect(buildResolutionOptions()).toEqual([
  { value: '1080x1920', label: '高清' },
  { value: '720x1280', label: '标清' },
  { value: '540x960', label: '流畅' },
])
```

第一次运行正确失败：

```text
TypeError: buildResolutionOptions is not a function
1 failed | 2 passed
```

#### GREEN

添加最小纯映射实现后：

```text
export-view-model.test.ts
3/3 passed
```

同时复验：

```text
export-api.test.ts
4/4 passed
```

---

### 最终文件规模

| 文件 | 行数 | 唯一变化原因 |
| --- | ---: | --- |
| `shot-detail.tsx` | 144 | 分镜详情页面组合 |
| `use-shot-runtime.ts` | 73 | 分镜客户端异步运行状态 |
| `shot-player.tsx` | 188 | 分镜媒体展示与控制 |
| `shot-detail-panels.tsx` | 109 | 分镜代码与合同展示 |
| `export-workspace.tsx` | 107 | 导出页面组合、预览与时间线 |
| `use-export-runtime.ts` | 52 | 导出客户端异步运行状态 |
| `export-review.tsx` | 234 | 导出设置与 Final QA |
| `export-view-model.ts` | 50 | 无副作用 UI 投影 |

两个入口文件和所有新增生产文件都不超过 250 行。

---

### Baseline 与治理文档（commit `9c28f02`）

#### `scripts/verify/v3-architecture-baseline.json`

删除两条失效记录：

```text
src/app/legacy/(app)/canvas/export/export-workspace.tsx
src/app/legacy/(app)/canvas/shot/[id]/shot-detail.tsx
```

没有把当前 `/products/*` 路径加入 baseline。

保持：

```json
"directOpenAiClientImports": 3
```

最终 `report.oversizedFiles` 只剩已登记的三个营销历史文件：

```text
src/components/marketing/fluid-cursor.tsx
src/components/marketing/launch-composer.tsx
src/components/marketing/showcase-cards.tsx
```

它们不属于 ISSUE-010。

#### `AGENTS.md`

移除已经还清的两条已知欠债，改为明确治理规则：

```text
pnpm verify:v3 的 architecture violations 必须保持为空；
不得把新超限文件写入 baseline 来掩盖门禁。
```

#### Issue 状态

更新：

```text
docs/issues/ISSUE-010-oversized-files.md
docs/issues/README.md
```

ISSUE-010 已由 `open` 更新为 `done`。

`docs/issues/README.md` 是并行共享文件。当时 ISSUE-013 也有未提交状态修改，因此只 hunk-stage 了 ISSUE-010 的 `open → done`，没有夹带 ISSUE-013。

---

### 真实 Chromium 验证

#### 验收数据

本地开发数据库在测试前没有任何 `shot-codegen` 节点，无法直接打开真实分镜详情页。

为了满足“真实 Postgres 页面、不得使用假 UI 数据”的验收要求，通过既有业务入口创建了本地验收项目：

```text
项目：ISSUE-010 Acceptance
projectId：41e32ec8-d721-40c8-a8ca-23763ec1d12e
shotId：aac1715a-7c89-56c2-9a9c-7b91aa72567f
laneKey：S001
```

数据建立方式：

- 项目通过现有 `POST /api/projects` 创建；
- 分镜通道通过现有 `materializeShotLanes()` 领域能力生成；
- 数据真实写入本地 Postgres；
- 页面没有注入 mock 或 fixture。

验收 URL：

```text
/products/shots/aac1715a-7c89-56c2-9a9c-7b91aa72567f
  ?projectId=41e32ec8-d721-40c8-a8ca-23763ec1d12e

/products/export/41e32ec8-d721-40c8-a8ca-23763ec1d12e
```

viewport：

```text
1440 × 1000
```

#### 为什么没有直接用主工作区做最终前后比较

拆分前截图完成后，其他并行任务开始修改两个页面直接依赖的共享 UI：

- `button.tsx`；
- `top-bar.tsx`；
- `timeline-track.tsx`；
- `status-pill.tsx`；
- `settings-row.tsx`；
- `toast.tsx`。

这些改动删除了多个 `font-sc` class，确实可能改变视觉，不能把它们误算成 ISSUE-010 的前后差异。

因此最终比较使用一个临时 detached 验证环境：

```text
before commit：b1a1669
after commit：978d463
```

两个版本使用：

- 同一 Postgres；
- 同一 URL；
- 同一 Chromium session；
- 同一 viewport；
- 不包含主工作区未提交的共享 UI 修改。

#### 分镜详情截图

```text
shot-before.png
shot-after.png
```

尺寸：

```text
1440 × 1000
```

两文件 SHA-256 完全相同：

```text
3762FA60E3A72868072B9C2E7FE64FCAADC6802CED0715DE8D72C04ED4EFCADB
```

Console errors：

```text
0
```

#### 导出工作区截图

```text
export-before.png
export-after.png
```

尺寸：

```text
1440 × 1000
```

两文件 SHA-256 完全相同：

```text
279A518A301E3B2A2D19A7F1353DD1D4DCA88FE60846205066FD43CA76C65526
```

Console errors：

```text
0
```

真实 API：

```text
GET /api/render/export
HTTP 200
```

结论：两组 before/after 截图分别逐字节完全相同，不只是尺寸相同或人工观察近似。

详细证据：

```text
docs/issues/evidence/issue-010/baseline.md
docs/issues/evidence/issue-010/shot-before.png
docs/issues/evidence/issue-010/shot-after.png
docs/issues/evidence/issue-010/export-before.png
docs/issues/evidence/issue-010/export-after.png
```

---

### 验证证据

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 100 files / 434 passed，exit 0 |
| `pnpm verify:v3` | `ok: true`、`violations: []`，exit 0 |
| `pnpm build` | 编译、TypeScript、静态生成完成，exit 0 |
| `git diff --check` | exit 0 |
| U+FFFD 扫描 | 0 matches |
| Chromium 分镜页 | console error 0，前后截图 SHA-256 相同 |
| Chromium 导出页 | console error 0，API 200，前后截图 SHA-256 相同 |

#### 全量测试第一次超时说明

第一次将 `pnpm test` 与 lint/typecheck/verify 并行执行时，出现两个超时：

```text
src/lib/queue/init.test.ts
src/features/director/startup-boundary.test.ts
```

两项都属于同期并行修改的 queue/Director 初始化路径，不在 ISSUE-010 范围内。

随后进行了两层复验：

1. 定向运行两文件：2 files / 6 tests 全部通过；
2. 独占重跑 `pnpm test`：100 files / 434 tests 全部通过。

因此确认第一次失败来自并行资源争用，不是 ISSUE-010 行为回归。

#### Build 非致命诊断

`pnpm build` 最终 exit 0，并完成：

- production compilation；
- TypeScript；
- page data；
- 16 个静态页面生成；
- 路由表输出。

但成功结束后仍打印三条：

```text
Cannot find module as expression is too dynamic
```

该诊断来自同期接回的 pi-agent/Director 动态模块加载，不属于 ISSUE-010 文件范围，也没有使 build 失败。证据文档已如实记录，没有将其描述成“输出完全无诊断”。

---

### 提交记录

| Commit | 内容 |
| --- | --- |
| `c560044` | ISSUE-010 职责拆分设计 |
| `b1a1669` | ISSUE-010 逐步实施计划 |
| `7ae6b26` | 分镜详情职责拆分 |
| `978d463` | 导出工作区职责拆分 |
| `9c28f02` | baseline、AGENTS、Issue 状态与 Chromium 证据 |

全部提交直接落在本地 `master`。

没有：

- push；
- 创建 PR；
- force push；
- amend；
- `--no-verify`；
- `git reset --hard`；
- `git checkout --`；
- 清除其他并行任务的工作树修改。

---

### 并行会话注意事项

本次与多个其他 Issue 共用同一个主工作区和暂存区。执行过程中已经观察到其他提交插入 ISSUE-010 提交之间，例如：

- Director 运行时；
- credentials 文档与 bootstrap；
- ISSUE-013 分析；
- ISSUE-009 共享 UI/路由收敛。

本次每个阶段都执行了精确路径暂存和 staged 文件检查。

其中 `docs/issues/README.md` 同时存在 ISSUE-010 与 ISSUE-013 两个 hunk，最终通过交互式 split 只暂存 ISSUE-010 行。

**重要：**

```text
src/app/products/(app)/export/[projectId]/export-review.tsx
```

在 `978d463` 提交后，又被并行任务修改了字体 class。该后续工作区修改不属于 ISSUE-010，没有被 `9c28f02` 夹带。

若要审查 ISSUE-010 刚完成时的纯净导出实现：

```powershell
git show 978d463 -- "src/app/products/(app)/export/[projectId]"
```

若要审查 ISSUE-010 完整关闭提交：

```powershell
git show 9c28f02
```

不要把主工作区当前未提交的字体 class 变化归入 ISSUE-010。

---

### 未纳入本次 commit 的工作区改动

任务完成时，以下类别仍存在其他并行任务的 staged/unstaged 修改，已刻意排除：

- `docs/conventions/routing.md`；
- `docs/issues/ISSUE-009-routing-convergence.md`；
- `docs/issues/ISSUE-013-ai-adapter-boundary.md`；
- `src/app/README.md`；
- `canvas-inspector.tsx`；
- `robots.ts` / `sitemap.ts`；
- 多个 `src/components/ui/**` 文件；
- `src/lib/api.ts`；
- queue 相关文件；
- 其他 Issue 的 evidence 和测试。

这些改动没有被清理，也没有被 ISSUE-010 提交吸收。

接手人应继续按各自 Issue 的责任边界提交，不要使用 `git add .`。

---

### 本地验收数据

本地 Postgres 中新增了：

```text
ISSUE-010 Acceptance
```

这是为了真实浏览器验收创建的开发数据库项目，不是生产数据，也没有进入 Git。

包含：

```text
projectId：41e32ec8-d721-40c8-a8ca-23763ec1d12e
shotId：aac1715a-7c89-56c2-9a9c-7b91aa72567f
laneKey：S001
```

后续若清理，应精确删除该项目及其级联开发数据，不要按模糊标题或批量条件删除其他项目。

---

### 已知问题：临时验证目录残留

为了隔离并行共享 UI 修改，曾创建临时 detached worktree：

```text
C:\Users\AIMFl\AppData\Local\Temp\purpleink-issue010-visual-5138b51277704e6cafeda19a3a1707ef
```

Git worktree 登记已经移除：

```text
git worktree list
```

只剩主仓库。

但 Windows 在移除 worktree 时报告目录非空，随后环境安全策略拒绝递归删除，因此目录本体仍可能残留，主要包含：

- `node_modules`；
- `src`；
- `server`；
- `public`；
- 安装后的工作副本文件。

该目录：

- 已不再是有效 Git worktree；
- 不影响主仓库状态；
- 不包含本次未提交源码；
- 可能占用较多磁盘空间。

如需人工清理，只允许针对上述**完整精确路径**操作。禁止递归删除 `%TEMP%`、用户目录或项目根目录。

---

### 未完成事项

ISSUE-010 自身的实现、验证、文档和状态更新已全部完成，没有剩余功能性必做项。

仅有两个仓库外/范围外事项：

1. 可择机清理上述系统临时目录；
2. Director 动态模块的三条 build 非致命诊断应由对应 Director/pi-agent Issue 继续调查，不应回到 ISSUE-010 修改。

本 issue 不需要继续修改生产代码。

---

### 给下一位执行者

1. **两个入口现在只做组合**：不要把播放器、异步状态或复杂评审逻辑重新堆回 `shot-detail.tsx` / `export-workspace.tsx`。
2. **分镜运行状态唯一位置**：`use-shot-runtime.ts`；继续复用 `shot-api.ts`，不要新增第二套 render/fetch wrapper。
3. **分镜媒体职责唯一位置**：`shot-player.tsx`；逐帧、时间码和缩略图都应留在这里。
4. **分镜展示职责唯一位置**：`shot-detail-panels.tsx`；`shot-panels.tsx` 只负责响应式容器、Drawer 和 resize。
5. **导出运行状态唯一位置**：`use-export-runtime.ts`；乐观更新与失败回拉逻辑不得在页面和面板之间复制。
6. **导出设置与 QA 唯一位置**：`export-review.tsx`；注意当前工作区可能还有 ISSUE-009 的字体 class 后续修改。
7. **纯映射继续放在 `export-view-model.ts`**：不要把 React、hook 或 API 依赖引入其中。
8. **不得恢复两条 legacy baseline**，也不得把当前 `/products/*` 路径写进 oversized baseline。
9. **复验 architecture gate**：
   ```powershell
   pnpm verify:v3
   ```
   预期 `ok: true`、`violations: []`。
10. **复验 ISSUE-010 代码提交**：
    ```powershell
    git show 7ae6b26
    git show 978d463
    git show 9c28f02
    ```
11. **复验浏览器证据**：查看 `docs/issues/evidence/issue-010/baseline.md`；两组截图的 before/after 哈希应分别一致。
12. **并行提交必须精确暂存**：README 和 `export-review.tsx` 都已发生过真实文件争用，提交前务必检查：
    ```powershell
    git diff --cached --name-status
    ```

ISSUE-010 已正式关闭。

先看一下交接文档的风格模板（原 `state-handoff.md` 已被并行执行者改名为 Batch-* 系列，取最新一份参照）：
好——顺带解开了此前的悬案：ISSUE-004 会话在其交接文档里证实了 `97b741e` 的经过（内容是它的队列改动、提交信息是我的），双方记录已互相印证。以下按该交接风格直接输出 ISSUE-013 的完成与交接总结：

---

# ISSUE-013 交接总结

### 背景与范围

`docs/issues/` 只覆盖**前端画布 Director** 这套系统，不碰 `server/**`。ISSUE-013 是 **P2、两步交付**：第一步纯分析（第一批可并行），第二步代码收缩（闸门 = ISSUE-001 `done`）。范围严格限于 `src/features/ai/**` + `scripts/verify/v3-architecture-baseline.json`，与其他 open issue（002/005/006/008/009/011/012）文件零重叠。

问题本质：ISSUE-001 引入 `@earendil-works/pi-ai` 后，仓库里存在**两套 provider 客户端**（openai SDK 直连 vs pi-ai）。若不界定边界，同一 provider 会有两条调用路径、两套超时/重试/错误映射——正是 AGENTS.md 禁止的「同一职责的第二套实现」。门禁 `directOpenAiClientImports` 债务上限 3 已用满，意图明确：openai 直连是要收缩的存量债务。

---

### 深度分析结论（第一步，已写入 issue §5「第一步结论」）

| 项 | 结论 |
| --- | --- |
| `chat()` 三符号 | `GeminiAdapter` / `StepfunAdapter` / `createLlmFromSettings` 生产调用方为**零**（仅测试与 `index.ts` 转发），确认死代码 |
| `index.ts` 导出面 | `GeminiAdapter`、`validateGeminiKey` 均未经桶导出；全 src/ 零桶导入消费方，收敛无 breaking 风险 |
| vision-qa | openai 用法极薄（一次非流式补全 + image_url 内容块）；pi-ai **类型层面已支持图片**（`types.d.ts:239-243`）但透传未实测；实测 341 行距 350 上限仅 9 行 → 本次不动，迁移留作单独评估 |
| audio | `stepfun-audio-client.ts` 纯 fetch，零 openai 依赖，边界天然成立 |
| key 校验 | 可 fetch 化且**语义不降级**（保留 key+baseUrl+model 组合的 chat 探测，拒绝 `GET /models` 弱化方案）；422 契约在 route 层，替换实现零波及 |
| 决策层 | `config.ts` / `gemini-config.ts` / `model-routing.ts` 纯净（零请求代码），两套客户端共用，热更新语义（逐调用读 DB+env）未破坏 |

---

### 已落地改动

**第一步（分析落档）**
- `0e58b24` `docs(issues): record ISSUE-013 step-1 adapter boundary findings` — issue 文件 +89 行（五问结论 + 附带结论 + 运行时对比表 + 收缩预测 3→1→0）
- `d09fc18` `docs(issues): mark ISSUE-013 in-progress in index` — README 索引行（**夹带说明**：该提交带入了 ISSUE-003 执行者留在工作区的一行 `open→done` 状态改动，内容与事实一致但归属非本会话，已当场报告用户）

**第二步（代码收缩）**
- `2305884` `refactor(ai): key 校验 fetch 化并删除 chat 死代码`（6 文件，+174/-227）
  - `gemini-adapter.ts` / `stepfun-adapter.ts`：删 openai import、`createClient`、两个 Adapter 类、`createLlmFromSettings`；`validateGeminiKey(apiKey, overrides, fetcher?)` / `validateKey(apiKey, fetcher?)` 改 fetch 最小 chat 探测——URL 去尾斜杠归一（Gemini 默认 baseUrl 带尾斜杠）、`Authorization: Bearer`、`max_tokens:1`、`AbortSignal.timeout(15_000)`、0 重试、`res.ok && res.json()` 双重判定、日志形状 `{status, errorType}` 不变且绝不含 Key
  - 删除 `types.ts`（死类型）；`index.ts` 收敛到 schemas + key 校验/凭据存取 + config
  - 测试改写为 **DI fetcher 模式**（沿用 `stepfun-audio-client.test.ts` 先例，非 `vi.stubGlobal`），RED（4 失败）→ GREEN（8/8）全程留痕
- `d53270a` `chore(verify): directOpenAiClientImports baseline 3 降为 1` — 仅改一个数字，未跑 capture 脚本（避免重写 oversizedFiles）
- `3afbc57` `docs(issues): ISSUE-013 第二步收缩完成并留证` — issue §9 执行记录 + `evidence/issue-013/` 六份证据

**未动（禁区）**：`vision-qa.ts`（openai 唯一保留点）、`route.ts`/`route.test.ts`（mock 的是模块函数，零波及）、`schemas.ts`、`config.ts`、`gemini-config.ts`、`stepfun-audio-client.ts`、`package.json`（openai 依赖 vision-qa 仍需）、`server/**`。

---

### 验证证据（归档 `docs/issues/evidence/issue-013/`）

| 项 | 结果 |
| --- | --- |
| `pnpm lint` / `typecheck` | exit 0 |
| `pnpm test` | 100 files / 435 passed，exit 0 |
| `pnpm verify:v3` | **exit 0**，实际 1 == cap 1（§8.1 ✅） |
| `pnpm build` | exit 0 |
| grep `from 'openai'` | 全仓 1 命中（`vision-qa.ts:3`）== baseline（§8.5 ✅） |
| 422 真实请求 | StepFun / Gemini 错误 key 均 **HTTP 422**；before/after `verifiedAt` 逐字节一致 → 未覆盖已存 Key（§8.3 ✅）；且真实验证了新 fetch 实现出网正确（含尾斜杠 URL 归一） |
| U+FFFD 扫描 | docs/issues 零命中 |

**已登记可接受漂移**：超时异常名 `APIConnectionTimeoutError` → `TimeoutError`；非 2xx 日志 `errorType` 统一为 `HttpError`（`status` 仍为真实状态码）。布尔结果与「不泄 Key」不变。

---

### 已知问题与待办

1. **§8.4 shot-qa 回归证据待补（唯一未关闭项）**：DB 中 16 个 shot 节点全 `idle`、无渲染产物，且 **ISSUE-002 仍 `open`**，pipeline 推不到 shot-qa。vision-qa.ts 本次零改动，回归风险极低。**ISSUE-013 状态因此保持 `in-progress`，不虚报 done。**
2. **提交信息错位事故（已双向记录）**：`97b741e` 内容是 ISSUE-004 的队列改动、提交信息却是本会话的 docs 消息——成因是两个并发会话共享暂存区的竞争（对方的 Batch handoff 已从它那侧证实）。用户已确认**不 amend**。本会话此后全部改用 `git commit -- <paths>` 路径限定提交，未再发生错位。
3. **StepFun `GET /models` 未实测**：第一步留的悬项，因最终采用「保留 chat 探测」方案而不再需要。

### 给下一位执行者

- **关闭 ISSUE-013 只差一件事**：ISSUE-002 落地、链路首次真实跑通后，把 vision QA 报告 JSON（含逐条 mustShow/mustAvoid evidence，证明非恒真）放进 `evidence/issue-013/`，然后把 issue `:4` 与 README `:131` 改 `done`。
- **不要**给 `vision-qa.ts` 加行（341/350）；若做 baseline 1→0 的 vision-qa 改造，先拆文件再动，且需真实实测 pi-ai 图片透传。
- **不要**恢复 `chat()` 或向 features/ai 加任何 `from 'openai'`——cap==actual==1，加一行即红。
- 校验函数签名新增了可选 `fetcher` 尾参，route 调用点无感知；写新测试请沿用 DI fetcher 模式。
- 并发会话共用工作区时：提交一律 `git commit -- <paths>`，提交后 `git show --stat` 核对文件清单。