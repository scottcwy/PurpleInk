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
- [ ] 阶段 5：权威规范同步，全量门禁和三来源真实 E2E。

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

## 安全边界

- managed、BYOK、custom 的凭据、资金、额度与并发不得互相回退。
- 不持久化或输出凭据、Prompt、Provider 原始响应及隐藏推理。
- 历史已完成记录和 approved/released Artifact 不回写。
- `docs/archive/**` 保持历史只读。
- 每阶段只精确暂存本阶段文件；不处理工作树中既有 `.docx` 删除。
