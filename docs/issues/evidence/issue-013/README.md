# ISSUE-013 第二步收缩 · 证据（2026-07-25）

代码变更：删除 `GeminiAdapter` / `StepfunAdapter` / `createLlmFromSettings` 死代码与
`features/ai/types.ts`；`validateGeminiKey` / `validateKey` 从 openai SDK 改为 fetch
最小 chat 探测（语义不变：key + baseUrl + model 组合、`max_tokens:1`、15s 超时、0 重试）；
`v3-architecture-baseline.json` 的 `directOpenAiClientImports` 3 → 1。

## 文件索引

| 文件 | 内容 |
| --- | --- |
| `dead-code-grep.txt` | 收缩后全仓 grep：`from 'openai'` 仅剩 `vision-qa.ts:3`；三个死符号零命中 |
| `settings-before.json` | 422 探测前 `GET /api/settings` 快照（describe 投影，无 secret） |
| `settings-422-stepfun.json` | 错误 StepFun Key 真实 POST 的 422 响应体 |
| `settings-422-gemini.json` | 错误 Gemini Key 真实 POST 的 422 响应体 |
| `settings-after.json` | 422 探测后快照，与 before 对比证明未覆盖已存 Key |

## 门禁结果（本地实跑，2026-07-25）

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 100 files / 435 passed，exit 0 |
| `pnpm verify:v3` | **exit 0**，`directOpenAiClientImports` 实际 1 == baseline cap 1 |
| `pnpm build` | exit 0 |

## 422 真实请求（§8.3）

对本地 dev server（fetch 化后的新实现，真实打到两家 provider 端点）：

- `POST /api/settings` + `{"apiKey":"sk-invalid-issue013-evidence"}` → **HTTP 422**
- `POST /api/settings` + `{"gemini":{"apiKey":"bad-gemini-key-issue013"}}` → **HTTP 422**
- before/after 快照中 StepFun `verifiedAt=2026-07-25T07:22:07.744Z`、
  Gemini `verifiedAt=2026-07-25T07:29:34.759Z` 逐字节一致 → 校验失败未覆盖已存 Key。
- Gemini 探测经带尾斜杠的默认 baseUrl 真实出网，URL 归一化正确（未出现双斜杠 404）。

## 已知可接受漂移

- 超时异常名由 openai SDK 的 `APIConnectionTimeoutError` 变为 `AbortSignal.timeout` 的
  `TimeoutError`；布尔结果与日志形状（`{ status, errorType }`，绝不含 Key）不变。
- HTTP 非 2xx 的日志 `errorType` 由 SDK 异常类名（如 `AuthenticationError`）统一为
  `HttpError`，`status` 字段仍保留真实状态码。

## 待补项（§8.4）

shot-qa 视觉 QA 真实回归**暂不可采集**：DB 中 16 个 `shot-codegen` / `shot-qa` 节点
全部 `idle`，无渲染产物；且 ISSUE-002（FABRICATE→render 接缝断裂）仍 `open`，
pipeline 无法推进到 shot-qa 阶段。vision-qa.ts 本次零改动（grep 证据在
`dead-code-grep.txt`），行为回归风险极低。待 ISSUE-002 落地、链路首次真实跑通时，
将 vision QA 报告 JSON 补充至本目录后，ISSUE-013 方可改 `done`。
