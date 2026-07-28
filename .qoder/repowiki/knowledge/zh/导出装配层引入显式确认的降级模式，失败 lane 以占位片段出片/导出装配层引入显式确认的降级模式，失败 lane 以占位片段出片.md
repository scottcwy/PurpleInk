---
kind: design
name: 导出装配层引入显式确认的降级模式，失败 lane 以占位片段出片
source: session
category: adr
---

# 导出装配层引入显式确认的降级模式，失败 lane 以占位片段出片

_来源：829be45 → dde74a1 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
分镜失败（如 S007 codegen 失败）会阻塞整片导出：失败 lane 的 render/subtitle 节点标记 incompleteNodeIds 与 blockingIssues，export 永远 idle。单节点失败率约 14%，用户无法在部分失败时先出片再补渲。

## 决策驱动
- 允许用户在显式确认后跳过失败 lane 出片
- 不改动节点状态机与 score 阶段合同
- 保持正常导出路径零变更

## 备选方案
- **新增 skipped 节点状态并扩展转换表** _（已否决）_ — 优点：语义清晰，支持 Inspector 级跳过动作；缺点：需改 status 枚举、DB CHECK、全部 Record<NodeStatus,...> 映射与迁移，模式 C 风险高；导出层降级已覆盖需求
- **独立 generate-placeholder 队列 lane** _（已否决）_ — 优点：并发生成占位片段；缺点：失败 lane 通常 1~3 条、单条黑场仅 1~3 秒，在 export-project 作业内串行即可，属过度设计
- **修改 loadAllRenderedArtifactKeys 返回缺失清单** _（已否决）_ — 优点：统一收集缺失 artifact；缺点：波及 score 阶段输入合同（ASSEMBLE 消费方），score 失败本是连带、占位后自愈，无需动 director 合同
- **drawtext 烧字入视频轨** _（已否决）_ — 优点：直观标注；缺点：Windows/Docker 字体链风险；现有 ASS 字幕链路已被真实验证支持中文
- **自动降级（autopilot 透传 degraded）** _（已否决）_ — 优点：无需用户干预；缺点：违反门禁不放松边界，降级必须用户显式确认

## 决策
在导出装配层（media-assembly.ts / getExportPlan）增加可选 degraded 开关：POST body 显式传入 degraded: true 才放行失败 lane；失败 lane 由 placeholder-clip.ts 生成纯黑场 MP4（无 drawtext，通过 ASS 硬字幕注入占位标注），时长/分辨率/fps 对齐真实 render-mp4 参数；final-mp4 登记 payload 记 placeholderLanes 与 degraded: true，UI 显示降级导出提示。S007 真实重渲后 version 递增，下次导出自动使用真实片段。

## 影响
导出失败不再堵死全片；用户可先出片再补渲。代价是 final-mp4 中混入占位片段，需 UI 明确标识；narration 缺失或 ingest 音频合同缺失仍 409 拒绝，保证基本合同。文件规模门禁将降级编排拆至 export-degraded.ts，export-service 只做分发。