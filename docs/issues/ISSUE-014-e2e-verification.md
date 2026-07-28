# ISSUE-014 · 端到端验证与证据留存（先小后大）

- 优先级：**贯穿全程**
- 状态：`in-progress`（第一轮 G1–G6 全通过，证据 `evidence/issue-014/`；第二轮待跑）
- 范围：`scripts/verify/`、`docs/issues/evidence/`。**不新增生产代码**
- 依赖：分阶段，见 §2
- 性质：验证基础设施 + 证据规范

## 1. 目标

用**真实模型调用 + 真实浏览器 + 真实 ffmpeg**，证明「给一段文本 → 得到一个 MP4」这条链路通。
不接受「单测通过」作为链路可用的证据。

链路全图见 `README.md` §3。

## 2. 两轮规模（已确认「先小后大」）

### 第一轮：极小闭环（证明链路通）

| 参数 | 值 | 理由 |
| --- | --- | --- |
| 输入文本 | 2 段，其中一段约 10 字、一段约 120 字 | 长短差异是 ISSUE-005 的验收前提 |
| 分镜数 | 2 | 最少能验证扇出与拼接 |
| 分辨率 | 低（如 640×360） | 迭代快 |
| fps | 24 | 帧数少 |
| 单镜时长 | 2 到 3 秒 | 每镜约 50 到 70 帧 |

第一轮要证明的**只有一件事**：六阶段依次成功，产出一个可播放的成片 MP4。

### 第二轮：贴近真实（证明质量与并发）

| 参数 | 值 |
| --- | --- |
| 输入文本 | 4 到 6 段，长度自然分布 |
| 分镜数 | 4 到 6 |
| 分辨率 | 1080p（`MASTER_RESOLUTION_PRESET`） |
| fps | 30 |
| 单镜时长 | 由真实 TTS 时长决定（ISSUE-005 落地后） |

第二轮额外要证明：并发通道生效（ISSUE-004）、时长真实（ISSUE-005）、
QA 真实判定（不是恒真）、画布状态与产物一致。

## 3. 分阶段验证门（每个 issue 交付后跑对应那一格）

| 阶段门 | 依赖 issue | 通过判据 |
| --- | --- | --- |
| G1 单阶段可执行 | 001 + 003 | `INGEST` 成功，产出 `director-ingest` artifact 与 `pi-session` JSONL |
| G2 计划链通 | G1 | `DIRECT` 成功，扇出出正确条数的泳道（`shot-script` / `shot-codegen` / `shot-sfx` / `shot-subtitle` / `shot-qa` 各 N 个） |
| G3 分镜合同 | G2 | `SHOT_SPEC` 成功，`shotPlan` 通过 `validate_shot_plan` |
| G4 单镜 MP4 | 002 + G3 | `shot-codegen` 产出 HTML 与 MP4，`ffprobe` 与 `renderSpec` 一致 |
| G5 音频真实 | 005 + G4 | 不同长度文本得到不同帧数，音频时长实测一致 |
| G6 成片 | G5 | `export` 产出终片 MP4，时长约等于各镜之和 |
| G7 并发 | 004 + G6 | 并发通道各自受独立配额约束，无 OOM |
| G8 画布一致 | 012 或轮询兜底 | 画布显示的状态与产物和 DB 完全一致，无假进度、无永久 Skeleton |

## 4. 证据规范

每一格通过后，把证据写进 `docs/issues/evidence/issue-0XX/`。
每份证据必须包含：

1. **时间戳与 git commit**（`git rev-parse HEAD`）。
2. **真实 HTTP 响应**：状态码 + 响应体（`/api/director/pipeline`、`/api/director/stage`、
   `/api/render`、`/api/render/export`）。
3. **SQL 查询结果**：相关 `canvas_nodes.status`、`artifacts`（`kind` / `content_hash` /
   `size_bytes` / `lifecycle` / `version`）、`task_attempts`（`status` / `failure`）。
4. **`ffprobe` 输出**：每个 MP4 的时长、fps、分辨率、编码。
5. **文件哈希**：产物字节的 SHA-256，且与 `artifacts.content_hash` **逐一比对一致**。
6. **真实 Chromium 截图**：画布页、镜头页、导出页；附浏览器控制台输出。
7. **可下载验证**：`/api/artifacts/{id}?projectId=` 真实返回字节且哈希匹配。

### 严禁

- 不得把 mock 输出、fixture 或 `server/out/cache/**` 的历史产物当作本轮证据
  （那些是后端智能体 URL→视频 链路的产物，**不是**本链路的，见 `README.md` §0）；
- 不得只贴单测结果；
- 无法完成某项验证时必须写明原因，**不得声称已验证**（AGENTS.md §8）。

## 5. 需要的验证脚手架

现有 `scripts/verify/` 只有 `v3-architecture.ts` 与 baseline 采集。
建议新增一个**端到端冒烟脚本**（`tsx` 直跑，不进 CI）：

```text
scripts/verify/e2e-smoke.ts
  1. 读 --script 文件或内联文本，POST /api/projects 建项目
  2. POST /api/director/pipeline 启动 autopilot
  3. 轮询 canvas 图直到全部终态或超时
  4. 断言：无 failed 节点；每个 shot-codegen 有 MP4；export 有终片
  5. 对每个 MP4 跑 ffprobe，与 renderSpec 比对
  6. 校验每个 artifact 的字节 SHA-256 与 content_hash 一致
  7. 输出结构化 JSON 报告到 docs/issues/evidence/
```

要求：

- **只读现有 API**，不绕过 API 直接写数据库；
- 超时必须有上限并如实报告卡在哪个节点/阶段；
- 失败时输出足以定位的信息，但**不得回显 prompt、凭据、原始 provider 错误**
  （AGENTS.md §6：不展示 raw assistant delta、tool 参数值、prompt、credential）；
- 不写入 `package.json` 的 `test` 脚本（它需要真实 key 与网络，不属于单测）；
  可加独立脚本入口如 `verify:e2e`。

## 6. 环境前置

| 项 | 状态（2026-07-25 实测） |
| --- | --- |
| Postgres | `purpleink-dev-postgres-1` healthy，`127.0.0.1:54328` |
| 迁移 | `pnpm db:migrate`；涉及新 migration 时需**连续执行两次** |
| Playwright Chromium | 已安装 |
| ffmpeg | `node_modules/ffmpeg-static/ffmpeg.exe` 存在 |
| `ffprobe` | **需确认**。`ffmpeg-static` 只提供 ffmpeg；ISSUE-005 也需要 ffprobe 测时长。若缺，需决定用 `ffprobe-static` 还是解析 ffmpeg 输出 |
| Gemini key | `server/.env` 有效；**Next 侧需 ISSUE-003 补齐** |
| StepFun key | 同上（`shot-sfx` / `shot-subtitle` 默认走 stepfun） |

> **注意 `ffprobe` 这一项是真实待办**，不要假设它已可用。
> 它同时是 ISSUE-005（实测音频时长）与本 issue（验证 MP4）的依赖。

## 7. 禁区

1. 不为了让端测通过而放宽任何门禁：确定性红线、`window.__CVC_RENDER__@v1` 合同、
   artifact 校验、QA 判定，一律不许降级。
2. 不在端测里注入假数据或跳过阶段。
3. 不把端测脚本做成「失败也返回 0」。
4. 不提交任何 `.env*`、构建物、`out/`、`.data/`、浏览器临时目录。
5. 证据里不得出现 API key、prompt 全文、原始 provider 错误体。
6. 不动 `server/**`，也不用 worker 的产物冒充本链路结果。

## 8. 验收标准

1. 第一轮（极小闭环）G1 到 G6 全部通过，证据齐全。
2. 第二轮（贴近真实）G1 到 G8 全部通过，证据齐全。
3. `docs/issues/evidence/` 下每个 issue 目录的证据符合 §4 的 7 项要求。
4. 终片 MP4 能真实播放，时长约等于各镜之和（允许拼接误差），
   画面与 `shotPlan` 的 `mustShow` 一致、不含 `mustAvoid`。
5. 全量门禁在两轮之间均保持：
   `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm verify:v3`、`pnpm build`、`git diff --check`。
6. 对 `AGENTS.md README.md docs src server scripts` 做一次 U+FFFD 扫描，零命中
   （`verify:v3` 的 `replacementCharacters` 已覆盖，确认为空即可）。
7. 本文件记录两轮的实际参数、耗时、以及与预期的偏差。

## 9. 第一轮执行记录（2026-07-26）

第一轮极小闭环**已通过**，G1–G6 全部满足，证据入档 `docs/issues/evidence/issue-014/`。

| 项 | 实际 |
| --- | --- |
| 稿件 | 2 段（短句 16 字 / 长句 89 字），切分为 3 个 script unit |
| 分镜数 | 3 |
| 分辨率 / fps | 1080×1920 @ 30（用母版预设，未降级到 640×360） |
| 单镜帧数 | 89 / 249 / 296（由各 unit 实测旁白时长决定） |
| 成片 | 634 帧 / 21.133 s，等于三镜帧数之和 |
| 墙钟 | 223.9 s |
| 节点 | 19 个全部 `succeeded` |

与 §2 预期的偏差：**分辨率与 fps 未按第一轮的低配参数执行**，直接用了母版
1080×1920 @30fps。原因是分辨率来自项目 `exportSettings` 默认值，冒烟脚本只驱动现有
API、不注入渲染参数（§7 禁区 2）。低配参数属可选加速项，非验收条件，故不为此新增
参数注入面。

### 脚手架

`scripts/verify/e2e-smoke.ts`（入口 `pnpm verify:e2e`）按 §5 实现，并额外满足：

- 只驱动 `POST /api/projects` 与 `POST /api/director/pipeline`，不绕过 API 写数据库；
  数据库仅只读用于取证核对；
- 超时有上限，超时如实报出卡在哪个节点及其状态，不返回 0；
- 失败信息不回显 prompt、凭据或 provider 原始错误。

### §6 环境前置的确认结果

- **`ffprobe` 确认可用但仓库不自带**：来自系统 winget 安装（`Gyan.FFmpeg`），
  `ffmpeg-static` 只提供 `ffmpeg.exe`。白盘 / CI 复现需自备。这一项此前标注为
  「需确认」，现给出确认结论。

### 新发现的真值缺口（未修，独立议题）

`pi-session` 的 `content_hash` / `size_bytes` 是**登记时刻快照**（实测 192 字节，
仅会话头一行），而 JSONL 在会话期间持续 append 至 4.9 KB–66 KB。会话在开始时即
登记是为了让失败也可追溯，但结果是该 artifact 的哈希与大小不描述实际最终字节，
与 AGENTS.md §6「`content_hash` 必须来自实际字节」不符。

冒烟脚本据此把 `pi-session` 单列为「实时会话日志」，断言「文件存在」而非哈希等值，
不冒充一致。建议的修法是在会话 close 后补登最终版本，属独立议题，本轮未做。

### 第二轮待办

§2 第二轮（4–6 镜、1080p、并发通道观测、QA 真实判定对比、真实 Chromium 截图）
尚未执行。G7 / G8 因此仍未取证。


## 多用户登录落地后的复核（2026-07-28 追加，不改写上方已核销内容）

- 登录改造（PLAN-002 阶段 B）触及 13 条既有 API 与队列执行路径，属链路级改动：
  **本 issue 的端到端证据需要重跑，不得沿用旧证据。**
- 重跑前置：`.env.local` 设置 `CVC_VERIFY_ACCOUNT=email:password`（真实注册账号），
  `e2e-smoke.ts` 会先登录再携会话 cookie 调业务 API；产物应归属该账号的 workspace。
- 未登录基线也要留证：`POST /api/director/pipeline` 现应回 **401**（旧证据里的
  409 + projectId 回显已在守卫接入时修复）。
