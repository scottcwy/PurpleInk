# docs/designs/

设计文档目录。视觉系统与 Pencil 交接物在此维护；v3 架构规范见仓库知识库
（`.qoder/repowiki`，工具自动生成），Demo v1 的历史架构文档已随重构归档。

## 用途

存放视觉设计与设计系统文档，包括：
- 视觉 SSOT（Pencil 源文件）
- 设计系统 token / 组件 / 页面索引
- 设计到代码的同步规则

## 当前权威

- `canvas.pen`：视觉 SSOT（像素真值），只能通过 Pencil MCP 访问；当前正式体系为 A → B → C → S，R2/R3 仅是来源档案。
- `Design-system-inventory.md`：token、组件、页面与同步规则的文字索引。
- `/playbook`：已登记组件的唯一清单（视觉验收）。

> 历史：`2026-07-23` 的 `ui-design-handoff.md`、`platform-architecture-design.md` 与
> `tasks.md` 等 Demo v1 文档已随 v3 重构删除，不再有对应页面合同。

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
