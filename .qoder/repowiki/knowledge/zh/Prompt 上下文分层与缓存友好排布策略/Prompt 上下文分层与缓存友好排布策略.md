---
kind: design
name: Prompt 上下文分层与缓存友好排布策略
source: session
category: adr
---

# Prompt 上下文分层与缓存友好排布策略

_来源：358c6a2 → 83136b7 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
Director 多泳道并行生成时，prompt 前缀不一致导致 provider 隐式缓存命中率低，影响整体吞吐。需在 shot-spec 与 fabricate 两个阶段优化上下文组织。

## 决策驱动
- provider 隐式 prompt cache 依赖字节级前缀一致
- 只有 SHOT_SPEC 与 FABRICATE 阶段需要完整上下文，其余阶段应精简
- styleBible 等大对象不应重复注入到每个子任务

## 备选方案
- **静态内容前置 + 动态内容后置 + styleBible 摘录** — 优点：同项目 N 条泳道共享稳定前缀命中缓存；shot-sfx/score 节点仅注入基调摘录（约 1000 字符）降低开销
- **接入显式 cache control API（Gemini cachedContent）** _（已否决）_ — 优点：显式缓存控制；缺点：pi-provider/billing 层改造面大，隐式前缀缓存已能覆盖主要收益

## 决策
重排 shot-spec.ts 与 fabricate.ts 的 prompt 结构：阶段说明+视觉法则（静态）→ style bible → audio allocation（共享）→ 当前目标镜头（动态）→ 提交方式；新增 styleBibleToneExcerpt 工具函数为 shot-sfx/score 注入基调摘录。

## 影响
依赖 provider 隐式前缀缓存机制，无需引入显式 cache API；runtime-artifact-reader.ts 中 shot-sfx 与 score 节点的 styleBible 注入改为摘要形式。