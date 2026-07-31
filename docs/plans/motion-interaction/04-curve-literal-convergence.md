# 04 · 曲线与时长字面量收敛（意图 4 / 17）

- 前置：02 完成（基线可比对）。与 03 无文件重叠，可并行，但**建议排在 03 之后**，
  这样营销页只需在 04 / 05 / 06 三批里验证一轮
- 消掉意图：4（折叠展开）、17（营销叙事进入）
- 共用硬边界与验证清单见 `00-README.md` §0

## 1. 目标与非目标

**目标**：消掉所有手写曲线与散落时长字面量，让营销层从「另一个动效宇宙」变成
「同一张 token 表的另一档」。

**非目标**：不改营销页的**观感节奏**。营销层该慢就还是慢——`narrative` 就是 300ms，
和现状一致。本批次是给既有数值一个名字，不是重新设计营销动效。
唯一例外是 `faq.tsx` 的体系外曲线（§3.2）。

## 2. 一条判断原则

营销层现在大量写着 `duration-300` / `duration: 0.3`。**这些不是错误，是没有名字的正确值。**
`narrative` 档就是为它们建的。所以本批次绝大部分改动同样是零视觉差异——
和 03 一样，先分清哪些是"改名"，哪些是"真改"。

**真改只有两类**：`faq.tsx` 的体系外曲线，以及 `canvas-auto-hide-top-bar.tsx` 的
手写贝塞尔（其值恰好等于 `ease-emphasized`，需实测确认是否零差异）。

## 3. 精确范围

执行前重新生成清单：

```powershell
Select-String -Path src/**/*.tsx -Pattern 'cubic-bezier'
Select-String -Path src/**/*.tsx -Pattern 'duration-(200|300|500|700)'
Select-String -Path src/components/marketing/**/*.tsx -Pattern 'duration: ?0?\.\d+'
```

### 3.1 应用层

| 文件 | 现状 | 目标 | 差异 |
| --- | --- | --- | --- |
| `canvas-auto-hide-top-bar.tsx` | `duration-[var(--duration-base)]` + `ease-[cubic-bezier(0.22,1,0.36,1)]` | `duration-base ease-emphasized` | 值相同，**预期零差异**，实测确认 |
| `collapsible-card.tsx` | `collapse` variants（tween 0.22 进 / 0.12 出） | `SPRING_SPATIAL_DEFAULT` | 真实差异，意图 4 |

`canvas-auto-hide-top-bar.tsx` 那处的手写贝塞尔参数 `0.22,1,0.36,1` 与
`--ease-emphasized` 完全一致，所以只是把内联值换成 token 引用。
它同时带着 `motion-reduce:transition-none`，**保留**——那是正确的局部兜底。

### 3.2 营销层

| 文件 | 现状 | 目标 | 差异 |
| --- | --- | --- | --- |
| `faq.tsx` | 手写 `duration: 0.3, ease: [0.25,0.46,0.45,0.94]` | `SPRING_SPATIAL_DEFAULT` | **真实差异**，见下 |
| `header.tsx` | 移动菜单 `duration: 0.2` | 覆盖层 recipe（→ 延后到 09） | 本批次不动 |
| `testimonials.tsx` | 多处 `duration-300` | `duration-narrative` | 零差异 |
| `tools-carousel.tsx` | 多处 `duration-300` | `duration-narrative` | 零差异 |
| `trusted-by.tsx` | 裸 `transition-colors` / `transition-all` / `transition-transform` | 补 `duration-narrative ease-standard`（营销节奏）| **非零差异**，见 §3.3 |
| `theme-switch.tsx` | `duration-300` | `duration-narrative` | 零差异 |
| `launch-composer.tsx` | 箭头 `duration-200` | 定档，见 §3.4 | 小差异 |
| `showcase-cards.tsx` | 箭头无时长 | 与 `launch-composer` 对齐 | 小差异 |

`faq.tsx` 的 `[0.25,0.46,0.45,0.94]` 在体系里不存在（是常见的 easeInOutQuad 变体，
凭手感敲进去的）。折叠展开归意图 4，统一走 `SPRING_SPATIAL_DEFAULT`，
这会让 FAQ 展开有轻微落位感——**这是本批次唯一刻意的观感变化**，需要单独确认。

### 3.3 营销层裸过渡不能简单套 `narrative`

裸 `transition-*` 现在吃的是 Tailwind 默认 150ms。若统一补成 `duration-narrative`（300ms），
是把它们**放慢一倍**，这是真实差异。

**决策**：营销层的 hover 类微交互（`trusted-by` 的 logo 变灰、链接变色）用
`duration-fast`，不用 `narrative`；`narrative` 只给**入场叙事**
（`whileInView`、首屏进入这类一次性动画）。理由：hover 是即时反馈，
在营销页也该跟手；`narrative` 的语义是"叙事", 不是"营销页的一切都慢"。

这条判断要回写到 `motion-interaction.md` §2.2 的 `narrative` 用途说明，
把它从"仅 (marketing) 段"精确成"仅 (marketing) 段的入场叙事"。

### 3.4 箭头微交互定档

`launch-composer.tsx`（`duration-200`）、`trusted-by.tsx`（无时长）、
`showcase-cards.tsx`（无时长）是同一个视觉效果——hover 时箭头右移。
三处统一为 `duration-fast`。`duration-200` 不在任何档位，是第五个隐式档。

## 4. 执行步骤

1. 先做应用层两处（§3.1），跑基线：`canvas-auto-hide-top-bar` 应零差异，
   `collapsible-card` 有预期差异。
2. 再做营销层零差异部分（`duration-300` → `duration-narrative`），跑基线确认零差异。
   **注意**：02 的基线目标不含营销首页；本批次要临时把 `/` 加进采集目标，
   或在 `02-visual-baseline.md` §3.2 补一行常驻。建议后者，因为 05 / 06 还要用。
3. 再做营销层真实差异部分（§3.3 / §3.4 / `faq.tsx`），逐项确认。
4. 回写 `motion-interaction.md`：§2.2 精确化 `narrative` 用途、§7.3 状态列、
   §3 意图 4 / 17 状态。
5. 更新 `/playbook/motion` 意图 4 / 17 为 `unified`。

## 5. 验证

- 营销首页必须进基线（本批次前置补上）；
- `faq.tsx` 折叠展开录屏确认落位感合理、无过冲果冻感（`bounce` 0.18 上限见规范 §5.2）；
- `canvas-auto-hide-top-bar` 需登录态真实路由验证（画布页），
  不能只看 playbook——它是 `/products/canvas/[projectId]` 的自动隐藏顶栏；
- 明暗双态 + `reduced-motion`；
- 共用清单全套 + `pnpm verify:motion`。

## 6. 风险与回滚

**风险 1：并行冲突。** `canvas-auto-hide-top-bar.tsx` 在画布目录下，
而并行工作正在改画布（右键菜单、lane panel）。执行前 `git log --oneline -5` 确认，
若该文件近期被改动，先读现状再动手。

**风险 2：营销首页动效密集且相互叠加**（Lenis 平滑滚动 + `useScroll` 视差 +
`whileInView` 入场）。单看某个组件的改动没问题，叠在一起可能观感不同。
必须整页录屏滚动一遍，不只截静止态。

**回滚**：建议拆三个提交（应用层 / 营销层零差异 / 营销层真实差异），
让"真改"部分可单独 revert 而不牵连改名部分。

## 7. 完成判据

- [ ] 全仓库 `src/**` 无手写 `cubic-bezier`（除 `globals.css` 的 token 定义本身）；
- [ ] 无 `duration-200` / `duration-300` 等非档位字面量；
- [ ] `faq.tsx` 的体系外曲线已消除；
- [ ] `narrative` 的用途说明已精确化为"入场叙事"；
- [ ] 营销首页已进基线并通过；
- [ ] 意图 4 / 17 标为 `unified`；
- [ ] 三个 Conventional Commit。
