# 03 · 控件状态层统一（意图 1 / 2 / 3）

- 前置：01 完成（`fast` = 150ms）、02 完成（基线可比对）
- 消掉意图：1（hover 换底色）、2（active 按压）、3（focus-visible ring）
- 共用硬边界与验证清单见 `00-README.md` §0

## 1. 目标与非目标

**目标**：让全站可点控件的交互态走同一套 token，并补齐 `design-quality-pitfalls.md` §1.5
要求的四态（hover 换底 / active 按压 / focus-visible ring / disabled 可辨）。

**非目标**：不动覆盖层内部的过渡（`tooltip.tsx`、`hover-preview.tsx` 属 09）；
不动营销层（属 04）；不改 `SPRING_SPATIAL_*` 参数值（见 §6.2 的待验项）。

## 2. 本批次最重要的一个性质：大部分改动可证明为零视觉差异

实测的 Tailwind 默认值（从构建产物 CSS 读出，非推测）：

```
--default-transition-duration: .15s
--default-transition-timing-function: cubic-bezier(.4, 0, .2, 1)
--ease-standard:                       cubic-bezier(.4, 0, .2, 1)   ← 完全相同
--ease-out:                            cubic-bezier(0, 0, .2, 1)    ← 不同
```

推论：

1. `duration-150` → `duration-fast`（150ms）是**零差异重命名**；
2. 裸 `transition-*` 补上 `duration-fast ease-standard` 也是**零差异**——
   因为它本来就在吃 150ms + 同一条曲线，只是没有名字；
3. 但 `ease-out` ≠ `ease-standard`，所以用了 `ease-out` 的两处是**真实差异**，
   必须单独归类。

因此本批次拆成两步，**验证判据完全不同**：

| 步 | 内容 | 验证判据 |
| --- | --- | --- |
| 03a | 语义化重命名与补全 | 基线比对**必须零差异**，任何差异都是缺陷 |
| 03b | 真实行为补齐 | 预期有差异，逐项人工确认并更新基线 |

先做 03a 并确认零差异，再做 03b。**两步分别提交**，否则 03a 的零差异判据会被 03b
的预期差异淹没，等于放弃了本批次最强的保护。

## 3. 精确范围

行号会随并行工作漂移。执行前用以下命令重新生成清单，**以命令输出为准**：

```powershell
# 显式 150 站点
Select-String -Path src/**/*.tsx -Pattern 'duration-150'
# 无显式时长的过渡（注意排除 duration- 已存在的行）
Select-String -Path src/**/*.tsx -Pattern 'transition-(colors|opacity|transform|all|shadow)(?![-\w])'
# active 态覆盖现状
Select-String -Path src/components/**/*.tsx -Pattern 'active:'
```

### 3.1 03a 零差异桶

**显式 150 → `duration-fast`（6 处，曲线不变）**

`button.tsx`、`segmented-control.tsx`、`text-field.tsx`（两个 variant 各一处）、
`toggle.tsx`（外层 label）、`icon-button.tsx`。

**裸过渡补 `duration-fast ease-standard`（应用层，11 处）**

`resize-handle.tsx`、`sidebar.tsx`（NavRow）、`toast.tsx`（关闭按钮）、
`sidebar-chrome.tsx`（两处：图标按钮、账户按钮）、`recent-projects-panel.tsx`、
`project-statistics-panel.tsx`、`collapsible-card.tsx`（头部按钮）、
`project-table.tsx`、`project-search-flyout.tsx`、`usage-panels.tsx`（两处）。

**不在本桶**：`tooltip.tsx`、`hover-preview.tsx`（→ 09）；`toggle.tsx` 的 knob
`transition-transform`（→ 03b）；`progress-bar.tsx` 的 `transition-all`（→ 03b）；
全部 `src/components/marketing/**`（→ 04）。

### 3.2 03b 真实差异桶

| 项 | 现状 | 目标 | 差异性质 |
| --- | --- | --- | --- |
| `nav-item.tsx` | `duration-150 ease-out` | `duration-fast ease-standard` | 曲线变化，末段减速略缓 |
| `section-nav.tsx` | `duration-150 ease-out` | `duration-fast ease-standard` | 同上 |
| `toggle.tsx` knob | 裸 `transition-transform` | `SPRING_SPATIAL_FAST` | 新增弹性，需改成 motion 组件 |
| `progress-bar.tsx` | `transition-all` | `transition-[width] duration-base` | 禁 `transition-all`（规范 §5.1）；顺带定档 |
| `icon-button.tsx` | 无 active 态 | 意图 2 | 新增按压 |
| `nav-item.tsx` | 无 active 态 | 意图 2 | 新增按压 |
| `segmented-control.tsx` | 无 active 态 | 意图 2 | 新增按压 |
| `button.tsx` `gray` variant | 有 `translate-y-px`，**漏了 `active:brightness`** | 补齐 | 修既有不一致 |
| `artifact-chip.tsx` | `hover:brightness-95` | 换底色 | **修 pitfalls §1.5 违规**，见 §3.3 |
| `sidebar-chrome.tsx` AccountMenu 行 | **完全无过渡** | 意图 1 | 修漏写，见 §3.4 |

### 3.3 `artifact-chip` 为什么算缺陷而不是风格差异

`design-quality-pitfalls.md` §1.5 明文写着 hover 要**换底色**，
并把 `brightness-105` 这类亮度微调点名为「肉眼不可见」的反面案例。
`artifact-chip.tsx` 的 `hover:brightness-95` 正是同一类。改成从 token 族推导的
底色迁移（参照 `hover:bg-ds-surface-muted` 的既有用法），不要新造颜色。

### 3.4 AccountMenu 行需要执行时复核

规划期观察到 `sidebar-chrome.tsx` 的 AccountMenu 列表行没有任何 `transition`，
鼠标移入是硬跳变。但该文件在并行工作中可能已变动，执行时先用 §3 的命令确认该行现状，
**若已被他人补上则跳过并在提交信息里说明**，不要重复改动。

## 4. 执行步骤

1. **03a**：按 §3.1 逐文件替换。全部完成后跑 `pnpm verify:motion`，
   **要求零差异**。若出现差异，先定位原因再继续——差异意味着某处的实际时长/曲线
   与假设不符（例如某个 `transition-[...]` 里混了非默认曲线），那是新发现的事实，
   要回写到 `motion-interaction.md` §7.3。
2. 提交 03a。
3. **03b**：按 §3.2 逐项改。`toggle` knob 需要从纯 CSS 改成 `motion.span`，
   注意它在 `has-[:focus-visible]` 选择器链里，改结构时不要破坏焦点环。
4. 更新基线（`pnpm verify:motion:update`），逐张人工确认差异**只**出现在 §3.2 涉及的组件上。
5. 更新 `/playbook/motion` 三条意图状态 `pending` → `unified`，
   删除对应的 `current` 字段（`motion-intents.test.ts` 会强制这一点）。
6. 同批回写 `motion-interaction.md` §7.3 状态列。
7. 提交 03b。

## 5. 验证

- **03a 的零差异比对是本批次的核心判据**，不可跳过、不可"目视觉得差不多"；
- 03b 后逐张 diff 人工确认，且差异范围可解释；
- 键盘验证：每个改过的控件 Tab 可达、`focus-visible` 环可见、
  鼠标点击**不**出现焦点环；
- `reduced-motion` 下 `toggle` knob 的 spring 被压平且开关状态仍可读
  （靠位移终态与 `aria-checked`，不靠动画）；
- 明暗双态；
- 共用清单全套 + `pnpm verify:motion`。

## 6. 风险与回滚

### 6.1 主要风险

**03b 的按压态是全站新增的交互反馈**，涉及 4 类控件。若 `translate-y-px` 在某些
布局里造成父容器抖动（尤其 `nav-item` 在窄侧栏的 rail 态），要改用 `scale` 或
放弃该控件的位移按压，并在规范 §3 意图 2 记录例外。

### 6.2 连带待验项（01 遗留）

`SPRING_SPATIAL_FAST` 的 `visualDuration = 0.18s` 是相对 `fast = 0.12` 选的；
校准后与 tween 档只差 0.03s。本批次是第一次把它用在真实控件（toggle knob、按压回弹）上，
**执行时必须录屏判断弹性是否还看得出来**，并回答：0.18 是否上调到 0.20–0.22。
结论写进 `motion-interaction.md` §2.4，若要改值则单独一个提交，不混在 03b 里。

### 6.3 回滚

03a 与 03b 分别是独立提交，可单独 revert。03a 因为零差异，revert 也零差异。

## 7. 完成判据

- [ ] 03a 完成且 `pnpm verify:motion` 零差异；
- [ ] 03b 完成，基线已更新且差异范围逐项可解释；
- [ ] 全站不再有 `duration-150` 字面量（应用层）；
- [ ] 应用层不再有无显式时长的 `transition-*`（覆盖层除外，属 09）；
- [ ] `artifact-chip` 的亮度 hover 已改为换底色；
- [ ] 意图 1 / 2 / 3 在 `/playbook/motion` 上标为 `unified` 且已移除 `current`；
- [ ] `SPRING_SPATIAL_FAST` 的手感结论已记录（无论是否改值）；
- [ ] 两个 Conventional Commit（03a / 03b），只含各自职责文件。
