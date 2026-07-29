---
kind: design
name: Director 管线通过分镜粒度细化与 FABRICATE 预算上调修复视频样式退化
source: session
category: adr
---

# Director 管线通过分镜粒度细化与 FABRICATE 预算上调修复视频样式退化

_来源：127ec9c → 21c9b6a 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
Director 管线生成的视频存在视觉质量退化问题，根因是 script unit 拆分过粗（多语义点合并）以及 FABRICATE 阶段字符预算仅 16000，无法支撑高质量可视化呈现。

## 决策驱动
- 镜头精度由分镜粒度决定
- 模型输出能力上限约 64K 字符
- 同一 DirectorSession 内重试不丢上下文
- 缓存命中率依赖 prompt 前缀稳定性

## 备选方案
- **分镜拆细 + 预算上调至 64000** — 优点：每镜 1-2 句保证语义完整；64K 贴合主流模型 maxTokens 上限；许愿式 prompt 提升视觉表现力
- **styleBible 结构化 JSON schema** _（已否决）_ — 优点：强类型契约；缺点：需改 DIRECT 输出、解析器与全部下游注入点，风险大且非当前退化主因
- **重试时重注入完整上下文** _（已否决）_ — 优点：显式保障；缺点：经核实同会话历史已累积 messages，属不必要改动
- **接入显式 cache control API** _（已否决）_ — 优点：可控缓存；缺点：pi-provider/billing 层改造面大，隐式前缀缓存已覆盖主要收益

## 决策
在 INGEST 阶段将 script units 按语义拆分为 1-2 句一镜，FABRICATE 预算从 16000 上调至 64000 字符并采用许愿式 prompt 基调；prompt 按静态规则→共享内容→逐镜动态分层排布以命中 provider 隐式缓存；重试仅追加质量保持指令而不改函数签名。

## 影响
镜头数增至 2-3 倍，队列并发配置需后续调优；降级路径（如 StepFun 32K 限制）输出能力低于预算但可通过显式标记可观测；styleBible 结构化留作后续演进。