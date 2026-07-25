# Qoder 架构审查与代码清洗账本 — 2026-07-25

> 职责：PurpleInk Stage A 合并后的独立代码审查、统一架构与深度清洗。
> 执行仓库：`D:\projects\Dev-Tools\PurpleInk-dev`（无 remote，全部本地提交）。
> 审查基线：`cec1a9c chore: close stage a migration`。
> 并行边界（本次全程未修改）：`src/app/playbook/**`、`src/app/(product)/**`、
> `src/components/ui/**`、`src/features/navigation/**`、全局样式/主题、`.pen` 文件、
> 只读来源仓库 `D:\projects\Dev-Tools\CodeVideoCanvas`。

## 0. 基线与环境登记

| 项目 | 实际结果 |
| --- | --- |
| 审查开始时 HEAD | `cec1a9c`，分支 `feature/merge-cvc`，工作树干净 |
| remote | 无（`git remote -v` 为空），未执行任何 push/PR |
| `BRANCH-DRIFT` | 实施期间分支被并行环境改名/切换为 `master`（HEAD 仍是 cec1a9c 的直接后代，历史未被改写）。遵守边界未 reset/切换，本次提交全部落在当前 `master` 上 |
| 并行 Agent 工作树改动 | 实施期间出现 `src/app/playbook/**`、`src/components/ui/**`、`src/features/workflow/`、`src/app/globals.css`、`tests/m6-route-shells.test.tsx` 等修改与未跟踪文件；全部保持原样，未纳入本次任何提交 |
| Postgres | `purpleink-dev-postgres-1` healthy，`127.0.0.1:54328` |

## 1. 架构与职责图（审查结论视角）

```text
浏览器
 ├─ /(marketing)  营销页 ── src/lib/api.ts ──> /api/engine/* ──rewrite──> server/ worker(8787)
 │                                                    worker: server/api → job-store(内存) → job-runner
 │                                                            → compose/run-pipeline(capture→tts→compose→render→verify→mux)
 ├─ /legacy/(app) CVC 过渡 UI ──> Next /api/*（薄入口，zod 校验）
 │        └─> features/{canvas,director,render,audio,ai,artifacts,credentials,routing}
 │                 └─> lib/{db(Drizzle+Postgres), queue(in-process), storage(local-fs), stream}
 ├─ /(product)    Stage B 路由壳（未接线，UnwiredPanel）  [并行只读区]
 └─ /playbook     组件登记                                  [并行只读区]
```

分层判定：
- `src/lib/**` 无反向依赖 `src/features/**`（已用 import 扫描证实）。
- `src/app/api/**` 均为薄入口：zod/手写解析 → features 公开导出 → 响应映射；未发现 route 内 SQL。
- web 与 worker 是两个独立 workspace 包，各自持有 `JobPhase`（合法重复），由 `tests/job-phase-contract.test.ts` 锁契约（本次已改为从 worker 源码派生，见 F-01）。
- features 间存在深导入（director↔render、render→canvas/contracts、audio→ai/config 等），属 CVC 迁移既有结构，见"不修清单"。

## 2. 发现清单（含证据与处置）

状态口径：`已修复` = 本次提交且测试/门禁验证；`不修` = 有意不动并给出原因；`未验证` = 仅静态证据、未运行时复现。

### P0

| # | 发现 | 证据 | 影响 | 处置 |
| --- | --- | --- | --- | --- |
| F-01 | web↔worker `JobPhase` 契约漂移：worker 真实上报 `muxing`（`server/src/compose/run-pipeline.ts:153`、类型 `server/src/server/job-store.ts:16`），web `src/lib/api.ts` JobPhase、`launch-composer.tsx` 的 `PHASE_LABEL`/`PHASE_BAND` 均缺失；运行中 250ms 进度定时器对 `PHASE_BAND[phase]` 解构 `undefined` 抛 TypeError（与 M5 已修的同类缺陷同根因，`muxing` 漏网）。旧契约测试是手抄清单，worker 侧漂移无感知 | `tests/job-phase-contract.test.ts`（旧版 L4-L15） | 真实任务进入混流阶段时前端进度条持续抛错 | **已修复**：契约测试改为从 worker 源码派生阶段（JobPhase 联合 + onPhase 字面量），三向锁定 worker 类型↔运行时上报↔web 类型↔进度呈现；web 补 `muxing` 类型/标签/进度带。RED(2 failed)→GREEN(3 passed)。提交 `0895c8c` |

### P1

| # | 发现 | 证据 | 影响 | 处置 |
| --- | --- | --- | --- | --- |
| F-02 | worker 把完整 stack（含本机绝对路径）写入对外可见错误：`job-runner.ts:75` `error: String(err?.stack || err)` 经 `toPublicJob` 回传前端；`server/api.ts:141/157` 500 响应直接 `String(err)` | 上述行号（修复前） | 信息泄漏（本机路径、依赖内部结构）到浏览器/任意 HTTP 调用方 | **已修复**：新增 `server/src/lib/error-message.ts`（对外仅 message），公开 error 字段走 `errorMessage()`，完整栈只进服务端 logger（键名 `stack`）。失败仍如实上报为 failed + 真实 message，无吞错。RED→GREEN `tests/worker-error-hygiene.test.ts` 3/3。提交 `8e19869` |
| F-03 | `LocalFsStorage.resolve` 用 `path.join(root,key)` 无越界防护，`../`、绝对路径 key 可穿出 root | `src/lib/storage/local-fs.ts:10-12`（修复前） | 当前调用方 key 均为内部构造，非直接用户输入，故实际可利用面低（定级 P1 防御纵深）；一旦未来 key 拼接用户输入即成任意读写 | **已修复**：resolve 后强制前缀校验，越界抛错；`localPath` 语义不变（生产 root `ARTIFACTS_DIR` 本就是绝对路径，`src/lib/config/paths.ts:8-13`）。RED(1 failed/7 passed)→GREEN(8/8)。提交 `706540e` |

### P2

| # | 发现 | 证据 | 影响 | 处置 |
| --- | --- | --- | --- | --- |
| F-04 | `verify:v3` baseline 配置漂移：oversizedFiles 键仍是 M5 前旧路径 `src/app/(app)/...`；登记的 `src/features/director/runtime-repository.ts`(565 行) 实际已拆分为 198 行；3 个 PurpleInk 营销文件(fluid-cursor 510/launch-composer 452/showcase-cards 443)未登记 → `pnpm verify:v3` 恒 exit 1，诊断失去信号 | 旧 `scripts/verify/v3-architecture-baseline.json` vs `--report` 实测输出 | 架构门禁形同虚设 | **已修复**：以真实扫描重生成 baseline；canvas 债务上限 23→15（收紧到实际值），移除已还清债务，登记现存债务的真实路径与行数。`pnpm verify:v3` 现 `ok:true` exit 0。提交 `a83357f` |
| F-05 | `.env.example` 变量名漂移：登记 `CAPTURE_DRIVER` 但代码从未读取（实读 `BROWSER_DRIVER`，`server/src/capture/browser-driver.ts:51`）；IMAP 自助注册需 `IMAP_HOST/IMAP_USER/IMAP_PASSWORD` 三者（`imap-email.ts:18`）但仅登记 PASSWORD | 上述行号 | 按示例配置无法生效，误导部署 | **已修复**：`CAPTURE_DRIVER`→`BROWSER_DRIVER`，补 `IMAP_HOST`、`IMAP_USER`（值保持为空）。`tests/env.test.ts` 敏感变量断言不受影响。提交 `a83357f` |
| F-06 | `toPublicJob` 额外回传 `createdAt/updatedAt`，web `JobView` 未声明 | `server/src/server/job-store.ts:98-99` | 契约面比声明宽；前端不读，无运行时危害 | **不修**：附加字段向后兼容、可能被 curl 用户使用；收窄无收益且有破坏面。登记为已知差异 |
| F-07 | features 间深导入（非 index 公开导出）：`render/queue-handler.ts:11→director/advance`、`director/stage-effects.ts:12-13→render/qa-check,vision-qa`、`render/concat.ts:7→canvas/contracts`、`audio/stepfun-audio-client.ts:3→ai/config` 等 | 各行号 | 边界模糊，重构摩擦 | **不修**：CVC 迁移既有结构，双向依赖需按 Stage B 域模型重划（director/render 的 QA 职责归属），当前大改属无收益重排且回归面大。列入 Stage B 建议 |
| F-08 | worker `POST /render` 手写校验宽松（可选字段仅规范化，未用 zod；zod 已是 server 依赖） | `server/src/server/api.ts:88-117` | 非法可选值静默降级（如 generation 回落 auto），本地 worker 面向内网 | **不修**（本轮）：行为如实、无假成功；换 zod 属改进而非缺陷修复。登记 P3 改进项 |
| F-09 | 营销/legacy 6 个超 350 行文件（见 F-04 清单）与 `page.tsx` 规模 | `verify:v3` 报告 | 维护成本 | **不修**：3 个 legacy 文件属并行只读区外的过渡资产（M4 已 waiver）、3 个营销文件为 PurpleInk 既有（M4 报告登记）；全部已在新 baseline 登记且禁止增长（`OVERSIZED_FILE_GROWTH` 规则生效） |

### P3 / 审查通过项（无需动作，登记结论）

- **Artifact 不可变性**：DB 触发器 `artifacts_immutable_lifecycle_trigger` 阻止 approved/released 的 UPDATE/DELETE（migration `0000_v3_postgres_foundation.sql:262-280`）；版本链走 `supersedes_artifact_id`，commit 走 `commitArtifactRecord` 悲观锁 + STALE_ATTEMPT 栅栏。✅
- **content_hash**：schema 强制 64 hex；写入方（render/audio/director artifact writer）均以实际字节 `createHash('sha256')` 计算。commit 层不对 storage 字节做二次校验——记录为 Stage B 可选加固（P3），未发现伪造路径。
- **凭据**：AES-256-GCM、随机 12B nonce、AAD 绑定 workspace+provider、master key 仅从 `CVC_CREDENTIAL_MASTER_KEY` 读且强校验 canonical base64，无明文 fallback；settings API 先 `validateKey` 再保存、`describe()` 只回 configured/verifiedAt/updatedAt，无明文/密文回显。✅
- **Postgres 单一数据源**：无 better-sqlite/Trigger/Pi 运行时 import（排除项与 M7 登记一致）；`getDb()` 进程内单例、失败可重试。✅
- **队列真实性**：in-process queue 状态/失败如实持久化到 `task_attempts.failure`，无吞错、无恒真。✅
- **SSE 契约**：stream-bus / director stream route / use-stage-stream 三方 snapshot/delta/done/error 一致。✅
- **Next 16 async API**：抽查全部 `src/app/api/**` 与动态页均 `await params`。✅
- **日志泄密**：server logger 调用点仅输出 id/path/布尔（`envKey: !!process.env.STEP_API_KEY` 为布尔）；`imap-email.ts` 对用户名做 mask。未发现 secret 值输出。✅
- **U+FFFD**：`verify:v3` 全仓扫描 replacementCharacters = 0。✅
- **死代码复核**：`audio-demo.ts` 被 `stage-result.ts`/`runtime-artifact-source.ts` 真实引用（子审查的"疑似死代码"判定不成立）；`pi-session/session-store` 是显式 NOT_AVAILABLE_STAGE_A 失败壳，属有意设计，保留。✅
- **`src/lib/api.ts` 轮询 `pollUntilDone`**：状态终判只认 worker 返回的 done/failed，无假进度真值（进度带只是展示层估计并有注释说明）。✅

## 3. 实际修复与提交清单

| 提交 | 范围 | 验证 |
| --- | --- | --- |
| `0895c8c fix(web): cover worker muxing phase in job contract and progress ui` | tests/job-phase-contract.test.ts、src/lib/api.ts、launch-composer.tsx | 契约测试 RED(2 fail)→GREEN(3/3) |
| `8e19869 fix(server): keep stack traces out of public job and http errors` | server/src/lib/error-message.ts(新)、job-runner.ts、api.ts、tests/worker-error-hygiene.test.ts(新) | RED(模块缺失)→GREEN(3/3)；`pnpm --filter purpleink-server typecheck` 通过 |
| `706540e fix(storage): reject keys escaping the local fs root` | local-fs.ts、local-fs.test.ts | RED(1/8 fail)→GREEN(8/8) |
| `a83357f chore(verify): refresh v3 baseline paths and align env example names` | v3-architecture-baseline.json、.env.example | `pnpm verify:v3` ok:true exit 0（此前恒 exit 1） |
| `docs(review)` 本报告 | docs/reviews/qoder-architecture-cleanup-2026-07-25.md | — |

另：同分支上的 `57d0812 feat: sync pencil design system and playbook` 为并行 Agent 提交，不属于本次职责。

## 4. 最终门禁证据

2026-07-25 串行执行（先脚本串行一轮，再对失败项归因复跑）：

| 命令 | 结果 |
| --- | --- |
| pnpm lint | 通过（exit 0） |
| pnpm typecheck | 通过（exit 0）；`pnpm --filter purpleink-server typecheck` 亦通过 |
| pnpm test | 首轮 2 失败：`src/lib/queue/init.test.ts`（负载抖动，单跑 2/2 通过，同 M7 登记的 KNOWN-VERIFY-CONTENTION）与 `tests/m6-route-shells.test.tsx`（失败断言位于并行 Agent 正在修改的未提交测试文件，非本次变更）。复跑：**89 files / 397 tests 全部通过** |
| pnpm test:pg | 15 files / 72 tests 通过（exit 0） |
| pnpm build | 通过（exit 0） |
| git diff --check | 通过（exit 0，含并行 Agent 未提交改动在内无 whitespace 错误） |
| pnpm verify:v3 | ok:true，exit 0（此前恒 exit 1） |
| U+FFFD 扫描 | 0（verify:v3 report.replacementCharacters） |
| 跟踪 secret/生成目录 | `git ls-files` 无 `.env.local`、`.data/`、`out/`、`output/`、`package-lock.json`、`.next/` |

说明：本次未触及 schema，无新 migration；`pnpm db:migrate` 双次幂等证据沿用 M7 登记，未重复执行（无变更范围触发）。HTTP 运行时证据：muxing 缺陷的复现路径依赖完整出片任务（约 2 分钟真实渲染），本次以"worker 源码上报点 + 前端解构点 + 派生契约测试"三重静态证据代替运行时复现，标注为 **未运行时复现**（回归由契约测试长期看护）。

## 5. 已知限制

- `BRANCH-DRIFT`：分支名在实施期间由外部改为 `master`；本次未创建/删除任何分支。若需要恢复 `feature/merge-cvc` 命名，请协调并行 Agent 后由维护者操作。
- 工作树在收口时仍包含并行 Agent 的未提交改动（playbook/ui/workflow/globals.css/m6 测试），`pnpm lint`/`typecheck`/`test` 结果不可避免地覆盖这些文件的当下状态；本人提交不包含它们。
- worker 无独立测试基础设施，F-02 的部分断言采用仓库既有的"跨目录读源码契约测试"风格（与 job-phase/env 测试同型），非运行时行为测试。

## 6. Stage B 建议（增量于迁移报告既有建议）

1. **共享 phase 契约模块**：web/worker 同仓不同包，可在 workspace 内提取单一 `job-phase.ts` 契约包，消除双定义（当前由派生测试看护，已够 Stage A）。
2. **director/render 边界重划**：QA（qa-check/vision-qa）目前被 director 深导入，Stage B 域建模时应归属明确的 application service，消除双向依赖。
3. **worker `/render` 入参 zod 化**（F-08）。
4. **artifact commit 时对 storage 字节做 hash 复核**（可选防伪加固）。
5. **`getExportReadiness` 的 best-effort QA catch**（`src/app/api/render/export/route.ts:20-28`）：当前失败会记日志且 readiness 如实反映未通过，不属假状态；Stage B 可把该失败上浮为 readiness 明细字段。
