---
kind: design
name: 分镜粒度细化：INGEST 按语义拆分 script units 为 1-2 句一镜
source: session
category: adr
---

# 分镜粒度细化：INGEST 按语义拆分 script units 为 1-2 句一镜

_来源：358c6a2 → 83136b7 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
Director 管线中分镜粒度过粗导致镜头承载内容过多、视觉表现力不足。拆细分镜的控制点在 INGEST 阶段的 unit 拆分规则，而非 DIRECT 阶段的协同强化。

## 决策驱动
- 每个 unit 对应一个分镜泳道，粒度直接决定镜头精度
- 保持语义完整性，允许超过 2 句但不允许多个独立语义点合并
- S/U 三位序号 schema 隐式约束上限 999

## 备选方案
- **INGEST 语义拆分 + DIRECT 协同强化** — 优点：从源头控制分镜粒度；DIRECT 追加一镜一个核心判断要求相邻镜头必须变化拓扑/视角/信息职责
- **仅改 DIRECT 阶段** _（已否决）_ — 优点：改动面小；缺点：无法改变上游 unit 划分，治标不治本

## 决策
在 ingest.ts 新增拆分规则：按语义拆分 script units，平均每 1-2 句话一个 unit，禁止多个独立语义点合并；direct.ts 追加协同指令确保相邻镜头变化。

## 影响
镜头数量预计增至 2-3 倍；现有队列并发由 env/DB 配置（CVC_QUEUE_*_CONCURRENCY）暂不修改，跑通后按实测吞吐调整配置。