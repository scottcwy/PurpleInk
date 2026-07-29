# AI 调用账本与真实统计验收记录（2026-07-30）

## 验收范围

本记录对应统一 `ai_invocations` 账本、账号与会员统计投影、工作台堆叠柱图、
会员周期累计额度折线图。营销页 `/api/engine/render` 不在本次范围。

## 真实链路证据

使用本地开发账号在当前生产构建创建项目
`AI 调用账本 V2 验收 2026-07-30`，工作流真实出网产生 3 条记录：

- 3 条均为 `telemetry_version = 2`；
- 3 条 `actor_user_id` 与 `pipeline_runs.requested_by_user_id` 均非空；
- 3 条均有 `provider_started_at`，状态为成功，`usage_status = reported`；
- funding 均为 `custom`，能力均为 `text`，供应商为 `openai-compatible`。

账号最近 7 天的 SQL、HTTP 与页面逐项一致：

| 指标 | SQL | `/api/ai-usage` | 工作台 |
| --- | ---: | ---: | ---: |
| 实际调用 | 3 | 3 | 3 |
| 成功调用 | 3 | 3 | 成功率 100% |
| 已报告 Token | 4,173 | 4,173 | 4,173 |
| 自己的 API | 3 | 当日 3 | 当日堆叠 3 |

当前会员周期累计额度百分比在 SQL、`managed-cycle` API 与会员图表中均为
`8.2%`。本次 3 条 custom 调用没有进入会员托管统计。

## HTTP 与安全投影

- 已登录 `account`、`managed-cycle`：200；
- 未登录：401；
- 非法 `range` 与非法 IANA 时区：400；
- 响应文本扫描未发现成本、Prompt、credential、输入输出哈希、内部 billing ID、
  `failure_kind` 或原始错误正文。

## 浏览器验收

真实 Chromium 已检查：

- 工作台 1440px Light、1440px Dark、390px Light；
- 会员页 1440px Dark；
- Dark 模式的根节点 `class=dark` 且 `color-scheme=dark`；
- 图表点/柱可聚焦，`details` 可展开数值表；
- 390px 首轮发现横向溢出，修复后图表仅在自身容器滚动；
- 最终页面控制台 0 error、0 warning。

本地截图保存在忽略目录 `output/playwright/ai-usage/`，不作为仓库产物提交。

## 自动化门禁

- `pnpm db:migrate` 连续执行两次：通过；
- `pnpm lint`：通过；
- `pnpm typecheck`：通过；
- `pnpm test`：190 个文件、1,140 项通过；
- `pnpm test:pg`：29 个文件、168 项通过；
- `pnpm build`：通过；
- U+FFFD 扫描：无匹配；
- 本任务文件 `git diff --check`：通过。

全仓 `git diff --check` 仍被用户保留的 `.qoder/repowiki/**` 并行改动中的尾随空格
阻断。本次没有改动这些文件。

`pnpm verify:v3` 当前仅剩并行开发中的
`src/lib/queue/in-process-queue.ts` 超过 350 行硬上限；本任务引入的架构违规为零，
但在并行版块完成拆分前，全仓门禁仍不能标记通过。

## 尚未接受

- Pencil MCP 两次返回“需要先在编辑器中打开文件”，因此
  `docs/designs/canvas.pen` 像素节点同步未验收；未绕过加密文件访问规则。
- 当前真实凭据只完成 custom 文本链路 E2E。managed/BYOK 文本、视觉、TTS、ASR
  与 custom TTS/ASR 已由单元/PG 合同测试覆盖，但未用全部真实供应商凭据逐项出网，
  因此这些外部 Provider 路径保持“自动化通过、真实 E2E 未验收”。
