# PurpleInk 工作流系统治理实施台账

日期：2026-08-01  
分支：`yusheng/two-part-merge`  
状态：实施中

## 目标

在不改变脚本、音频、网站三类项目既有拓扑、Prompt、Artifact 与供应商选择的前提下，统一模型路由、调用账本、失败分类、停止恢复和执行快照，消除重复解析与分裂真值。

## 已确认根因

1. `resolveBuiltInModelTarget` 用逻辑模型完成授权，再把出网模型交给 Director。
2. Director 调用网关时把出网模型写入 `model`，逻辑模型只存在 execution metadata。
3. 网关再次使用 `model` 授权和查询费率；当逻辑 ID 与出网 ID 不同时，合法路由被拒绝。
4. `ManagedAiError` 未被工作流分类器按结构识别，含“模型”的文案落入可重试 `PROVIDER_FAILED`。
5. 出网前错误没有 invocation，但节点重试预算仍被重复消耗。

## 控制链与提交点

`Project/Topology → Start/Attempt/Epoch → Queue/Lease → ExecutionPlan → Provider Dispatch → AI Invocation → Artifact → Node/Run → Execution Snapshot`

- attempt、run、node、invocation、dispatch、lease 均以 PostgreSQL 为结构化真值。
- Provider 出网前必须先建立 invocation/预留；失败或停止必须收敛为终态。
- Artifact 只有在真实字节落盘并计算 SHA-256 后才能登记。
- 旧 execution epoch 的迟到结果不得写节点或 Artifact。
- SSE 只提示失效，UI 必须重新读取数据库快照。

## 阶段验收

- [x] 阶段 0：事故 RED、只读 `verify:workflow` 和审计基线（`1e5d555`）。
- [x] 阶段 1：逻辑/出网模型分离，不可变执行计划覆盖所有 AI 路径（`e02df6e`、`f0dbddd`）。
- [x] 阶段 2：数据库时钟、停止语义、invocation/lease/ticket 对账闭环。
- [x] 阶段 3：三来源 `ProjectExecutionSnapshotV2` 与 v1 兼容投影。
- [x] 阶段 4：dry-run/apply 恢复工具，现存可变孤儿清零。
- [ ] 阶段 5：权威规范同步，全量门禁和三来源真实 E2E（外部验收进行中）。

阶段 2 验收证据：±90 秒主机时钟偏差、停止前/后 Provider 分流、旧 epoch
invocation/lease/ticket/Artifact 栅栏共 46 个定向 PostgreSQL 用例通过；全量 lint、
1710 个单元/契约测试、`verify:v3` 与生产构建通过。恢复工具 dry-run 重新确认
4 条 orphan invocation 与 10 条 orphan lease，未执行 apply。

阶段 3 验收证据：`routing.md` 先登记 v2 合同；脚本、音频、网站分别通过
判别联合投影 Director/fan-out/汇聚、ASR/原音频绑定与六阶段状态；UI 生产代码
已不再读取 `workflowKind/stages/currentStage` v1 顶层别名。客户端严格校验 v2
一致性，v1 字段继续保留一个发布周期。63 个快照、UI、ASR/TTS 聚焦用例与
2 个 PostgreSQL 快照用例通过；受影响的持久化状态时间改为数据库时钟。

阶段 4 验收证据：apply 前再次确认 14 条可变孤儿（4 条 Provider 已开始且
`not_applicable` 的 invocation、10 条无活动父任务的 waiting lease）；CAS apply
后活动孤儿为 0，第二次 apply 更新 0 条。`verify:workflow` 返回安全引用号
`01371bcb60dc`，7 项阻断检查全部为 0；1626 条历史时间逆序仅保留为只读 advisory，
未改写历史完成时间、failure 报文或 Artifact。脱敏快照保存在本地忽略目录
`.data/workflow-integrity/`，不进入 Git。

阶段 5 当前证据：真实脚本链的 SHOT_SPEC 已成功，证明逻辑/出网身份事故未复发；
真实音频链 9/9 节点完成，ASR、原音频绑定、Director、FABRICATE、汇聚、导出均通过，
27 条不可变 Artifact 的字节与 SHA-256 全部一致，最终 MP4 为 H.264/AAC、
1920×1080、30fps、10.233 秒。Chromium 画布与导出页返回 200 且无控制台/业务请求错误。

真实运行又发现并修复两条复发模式：无状态 Provider 终止事件曾丢成平台内部错误，
以及 TTS 合法字节因供应商声明时长为 0 在 worker 实测前被拒绝。脚本第二镜头与网站
修复后复测均在工作区 Free 周期额度耗尽后被确定性阻断；没有跨资金来源回退，也没有
把部分成功冒充为三来源最终验收。因此阶段 5 和失败模式关闭表保持待完成，直到额度
恢复后补齐脚本/网站终片证据与最终全量门禁。

阶段 5 收尾门禁（2026-08-01）：`pnpm lint`、`pnpm typecheck`、
`pnpm test -- --maxWorkers=4`（262 files / 1718 tests）、`pnpm verify:v3`、
`pnpm verify:workflow` 与 `pnpm build` 均通过；工作流审计安全引用号为
`c4ca6a9d32d8`，7 类 blocking 均为 0，1650 条历史时间逆序保持 advisory。
迁移连续执行两次通过。`test:pg` 的合同与功能断言通过 296/297，唯一未通过项是
既有 Max 并发性能门槛在完整串行套件中实测 p95 22.22ms（要求 `<20ms`）；同一
provider dispatch / workspace concurrency 聚焦套件曾 14/14 通过，随后独立复跑也
出现 23.80ms，确认为当前 Windows 测试机上的非确定性绝对时延门禁，不放宽阈值、
不记作全量通过。attempt completion 拆分后的 PostgreSQL 聚焦用例 13/13 通过。

## 安全边界

- managed、BYOK、custom 的凭据、资金、额度与并发不得互相回退。
- 不持久化或输出凭据、Prompt、Provider 原始响应及隐藏推理。
- 历史已完成记录和 approved/released Artifact 不回写。
- `docs/archive/**` 保持历史只读。
- 每阶段只精确暂存本阶段文件；不处理工作树中既有 `.docx` 删除。
