# 01 · `fast` 档校准为 150ms

- 前置：无，可立即开始
- 后续解锁：02（基线要含校准后的值）、03（零差异重命名的前提）
- 共用硬边界与验证清单见 `00-README.md` §0
- 决策依据：`00-README.md` D1

## 1. 目标与非目标

**目标**：把 `fast` 从 120ms 改为 150ms，让规范去适配现状，而不是让 8 处控件去适配规范。

**为什么这样反过来做。** 150ms 已经是事实标准：8 处控件显式写了它，另有 15+ 处裸
`transition-*` 隐式吃 Tailwind 默认值——而 Tailwind 的默认值实测就是
`--default-transition-duration: .15s`。也就是说全站控件的真实时长本来就统一在 150ms，
只是**没有名字**。校准 token 等于给既有的一致性一个名字，代价是零；
反向改动则要动 20+ 个文件并改变全站观感。统一比具体数值更重要。

**非目标**：不动 `base`（220ms）、`slow`（360ms）、`narrative`（300ms）；不动三条曲线。

## 2. 一个必须一起判断的连带项

`SPRING_SPATIAL_FAST` 的 `visualDuration` 是 0.18s，当初是相对 `fast = 0.12` 选的，
留了 0.06s 的余量。校准后余量收窄到 0.03s，弹性档和 tween 档几乎同速，
「小控件弹一点」的意图可能变得看不出来。

**处理方式**：本批次**不改** spring 参数，但在 `motion-interaction.md` §2.4 追加一条待验项，
留给 03 批次在真实控件（toggle knob、按压回弹）上跑过之后回答：
0.18 是否要上调到 0.20–0.22。不要在没有实物的情况下先猜一个数。

## 3. 精确范围

四个文件，改 5 处值 + 1 处已过期表述：

| 文件 | 改什么 |
| --- | --- |
| `src/app/globals.css` | `:root` 的 `--duration-fast: 120ms` → `150ms` |
| `src/lib/motion/tokens.ts` | `DURATION.fast: 0.12` → `0.15` |
| `docs/conventions/motion-interaction.md` | §2.2 表格 `fast` 行的值；§1 那条已过期的反面基线（见 §4.3）；§2.4 追加待验项 |
| `docs/designs/Design-system-inventory.md` | §4.7 索引表的时长一行 |

**不需要改**的地方（确认一遍，避免多余改动）：

- `src/lib/motion/tokens.test.ts` —— 同步测试从 CSS 读值比对，会自动跟随；
  现有断言只有 `DURATION.fast < DURATION.base`（0.15 < 0.22 成立）和
  `DURATION.base ≈ 0.22`，都不受影响。
- `src/app/playbook/foundations/motion-tokens-section.tsx` —— 显示值来自
  `DURATION.fast * 1000`，自动变成 150ms。
- `src/components/ui/context-menu.tsx` —— 用 `DURATION.fast`，自动跟随。
- 任何写着 `duration-150` 的控件 —— **本批次一律不动**，它们属于 03。

## 4. 执行步骤

### 4.1 改两处数值

`globals.css` 的 `:root` 与 `tokens.ts` 的 `DURATION.fast`。
注意 `globals.css` 是「`:root` 存语义值 + `@theme inline` 做 Tailwind 导出」两层结构，
`@theme` 那层引用的是 `var(--duration-fast)`，**不需要跟着改**。

### 4.2 跑同步测试确认双镜像一致

```powershell
pnpm vitest run src/lib/motion/tokens.test.ts
```

这一步是本批次的核心保护：`matches every duration value declared in :root` 用例会
逐项校验 JS 侧与 CSS 侧一致。若只改了一边，这里必红。

### 4.3 改写规范里已过期的表述

`motion-interaction.md` §1 现有这条：

> `duration-150` 出现 8 处，而体系三档是 120 / 220 / 360——150 不属于任何一档；

校准后它是错的。改写方向：保留「8 处显式 + 15+ 处隐式吃默认值」这个**事实**，
把结论从「150 不在体系内」换成「150 是事实标准但没有名字，token 缺少对应档位」。
同时把 §2.2 的四档表、§2.4 的待验项、`Design-system-inventory.md` §4.7 一并更新。

### 4.4 同批回写迁移总账

`motion-interaction.md` §7.1 追加一行记录本次校准（状态 `done`），
说明动机是 D1，避免后人看到 150 以为是没改干净的残留。

## 5. 验证

- `pnpm vitest run src/lib/motion/tokens.test.ts` 全绿（含双镜像同步用例）；
- 共用清单全套；
- 浏览器实测：`/playbook/foundations` 动效段的 `fast` 行显示 **150ms**，
  计算样式 `.duration-fast` 解析为 `0.15s`；
- UTF-8：对改动的两份文档做 U+FFFD 扫描（`verify:v3` 的
  `replacementCharacters` 为空即可）。

## 6. 风险与回滚

**风险极低。** 唯一的可见变化是 `/playbook/foundations` 与 `/playbook/motion` 上
`fast` 相关标本略慢 30ms，以及 `ContextMenu` 的 opacity 淡入略慢 30ms
（它是目前唯一消费 `DURATION.fast` 的生产组件）。全站其余控件不受影响，
因为它们还没用上 `duration-fast`。

**回滚**：单提交 revert 即可，无数据、无迁移、无外部依赖。

## 7. 完成判据

- [ ] `globals.css` 与 `tokens.ts` 的 `fast` 均为 150ms / 0.15，双镜像同步测试通过；
- [ ] `motion-interaction.md` §1 的过期表述已改写，§2.2 / §2.4 / §7.1 已更新；
- [ ] `Design-system-inventory.md` §4.7 已更新；
- [ ] `/playbook/foundations` 实测显示 150ms 且计算样式为 `0.15s`；
- [ ] 共用验证清单全套通过；
- [ ] 单个 Conventional Commit，只含上述四个文件。
