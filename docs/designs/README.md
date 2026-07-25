# docs/designs/

设计文档。v3 的规范性技术架构已经迁入
[`CVC-ARCH-V3`](../specs/2026-07-24-refactor-v3-architecture-spec.md)；本目录保留
视觉系统、Pencil 交接与 Demo v1 历史架构。

## 用途

存放架构设计和技术方案文档，包括：
- 系统架构设计（整体架构、模块划分、数据流）
- UI/UX 设计（页面布局、交互设计、组件设计）
- 技术方案（技术选型对比、方案决策记录）

## 当前权威

- `canvas.pen`：视觉 SSOT，只能通过 Pencil MCP 访问；当前正式体系为 A → B → C → S，R2/R3 仅是来源档案。
- `2026-07-23-design-system-inventory.md`：当前 Canonical token、16 个 B0 reusable symbols、组合模块、S1–S6 路由与同步规范。主题固定为 Porcelain Light / Obsidian Navy Dark。
- `../conventions/architecture-conventions.md#ui-design-ssot`：设计到代码的长期边界。
- v3 新 UI：按 N6 Track Plan 执行 Pencil reusable symbol → 截图验证 → React/demo → `/playbook` → 页面。
- `2026-07-23-ui-design-handoff.md`、`2026-07-23-platform-architecture-design.md` 与 `tasks.md`：冻结的 Demo v1 历史文档，不再提供当前 token 或页面合同。

## 文档结构模板

```markdown
# [Design Title]

> Created: YYYY-MM-DD
> Updated: YYYY-MM-DD
> Status: draft | review | accepted | deprecated

## 问题陈述
[要解决什么问题]

## 方案对比
[列出多个候选方案及其优劣]

## 最终决策
[选择了哪个方案]

## 决策理由
[为什么选择这个方案]
```
