# 动效与微交互规范

> Created: 2026-07-30 · Status: accepted
> 读者：所有改动画、过渡、覆盖层（弹窗 / 抽屉 / 菜单 / 提示）或页面容器的代理。
> 动手前必读 §2（token 消费路径）、§3（意图表）、§5（禁止事项）。
> 配套实物：`/playbook/motion`（意图对照台）、`/playbook/foundations`（token 对照）。

本文是动效数值的唯一文字真值。`docs/designs/Design-system-inventory.md` §4.7 只保留索引，
不重复列参数；`src/lib/motion/tokens.ts` 是本文 §2 的 JS 镜像，两者必须逐项对应。

---

## 1. 为什么必须统一

动效与颜色的失控方式不同。颜色写歪了肉眼可见，动效写歪了只留下一个说不清的"糙"感——
用户不会指出某个 hover 是 150ms 而非 220ms，但会形成整体印象，而这个印象是全部动效的
**平均分，不是最高分**。

更重要的是：造第二个 Button 需要新建文件，会被察觉；写第二个 `duration` 只需两秒，
不留痕迹。所以动效需要比组件更强的约束，而不是更弱。

本规范落地前的实测状况（作为反面基线保留）：

- `duration-150` 显式出现 8 处，另有 15+ 处裸 `transition-*` 隐式吃 Tailwind 默认的
  150ms——150 已是事实标准，却没有语义名字；
- hover 换底有 6 种写法，其中 `sidebar-chrome.tsx` 的 AccountMenu 行完全没有过渡；
- 折叠展开有 3 套实现，`marketing/faq.tsx` 用了体系内不存在的曲线 `[0.25,0.46,0.45,0.94]`；
- 覆盖层有 8 套独立实现，Dialog 无 ESC / 无 focus trap / 无 scroll lock，Toast 不会自动消失；
- 侧栏宽度动画在 SSOT 组件里是 200ms、在生产路径里是 220ms（两条并存，见 §7）。

根因不是不自觉，而是**正确的做法不是最省事的做法**：token 早已在 `globals.css` 定义，
但因命名空间配错而生成不出可用 class，开发者只能退回 Tailwind 默认值。§2 首先修这条路。

---

## 2. L0：Token 层

### 2.1 Tailwind v4 的命名空间陷阱（第一因）

Tailwind v4 从 `@theme` 读取的 duration 命名空间是 **`--transition-duration-*`**，
不是 `--duration-*`。只在 `:root` 定义 `--duration-base` 不会产生 `duration-base` class。

`globals.css` 因此维持两层：`:root` 存**语义值**，`@theme inline` 做**Tailwind 导出**。

```css
:root {
  --duration-fast: 150ms;
  --duration-base: 220ms;
  --duration-slow: 360ms;
  --duration-narrative: 300ms;
}
@theme inline {
  --transition-duration-fast: var(--duration-fast);
  --transition-duration-base: var(--duration-base);
  --transition-duration-slow: var(--duration-slow);
  --transition-duration-narrative: var(--duration-narrative);
  --ease-standard: var(--ease-standard);
  --ease-emphasized: var(--ease-emphasized);
  --ease-exit: var(--ease-exit);
}
```

产出的可用 class：`duration-fast|base|slow|narrative`、`ease-standard|emphasized|exit`。
**新增任何时长或曲线，必须同时改 `:root`、`@theme inline` 与 `src/lib/motion/tokens.ts` 三处**，
否则 `src/lib/motion/tokens.test.ts` 的同步测试会失败。

### 2.2 时长

| Token | 值 | 用途 |
| --- | --- | --- |
| `fast` | 150ms | 微交互：hover 换底、focus ring、图标色变、tooltip 淡入 |
| `base` | 220ms | 标准 UI 变化：面板、抽屉、折叠、路由转场 |
| `slow` | 360ms | 大面积或强调：全屏遮罩、TOC 定位发光 |
| `narrative` | 300ms | **仅 `(marketing)` 段**的叙事进入（见 §5.4） |

### 2.3 曲线

| Token | cubic-bezier | 用途 |
| --- | --- | --- |
| `standard` | `0.4, 0, 0.2, 1` | 默认。绝大多数变化 |
| `emphasized` | `0.22, 1, 0.36, 1` | 进入 / 展开。末段减速明显，有"落位"感 |
| `exit` | `0.4, 0, 1, 1` | 离场。加速冲出，不做减速 |

### 2.4 弹性（spring）

弹性**必须二分**，这是 Material 3 的 spatial / effects 分类依据：

- **spatial**（位移、尺寸、布局）允许 overshoot，弹性在这里是"有生气"；
- **effects**（颜色、透明度、滤镜）**禁止 spring**——`opacity` 不能弹到 1 以上，
  颜色不能弹出色域，overshoot 在这类属性上只会产生闪烁或脏色。

参数用 `visualDuration + bounce`，不用 `stiffness / damping`。理由：`visualDuration` 是
"视觉上到达目标的时间"，弹性部分主要发生在该时间之后，因此能与 §2.2 的时间轴对齐；
`bounce` 是单一可 review 的旋钮（0 = 不弹）。

| Token | visualDuration | bounce | 用途 |
| --- | --- | --- | --- |
| `SPRING_SPATIAL_FAST` | 0.18s | 0.22 | 小控件：toggle knob、chip、按压回弹 |
| `SPRING_SPATIAL_DEFAULT` | 0.28s | 0.18 | 中等面：抽屉、面板、折叠、侧栏宽度 |
| `SPRING_SPATIAL_SLOW` | 0.42s | 0.12 | 大面积：全屏转场 |

**bounce 与元素尺寸反相关**，这是刻意的：小控件弹一点有生气，大面积 overshoot 会被放大成
"果冻感"，正是 `design-quality-pitfalls.md` §1.2 要防的廉价感。不要按"越慢越弹"直觉设置。

**待验项（批次 03）**：`fast` 校准为 150ms 后，`SPRING_SPATIAL_FAST` 的 0.18s
只余 0.03s 弹性时间。须在真实 toggle knob 与按压回弹上判断是否仍有可辨识的弹性；
没有实物证据前不调整到 0.20–0.22s。

**例外：拖拽与惯性仍用物理参数。** `visualDuration / bounce` 不吸收当前手势速度，
不跟手。侧栏 / 面板拖拽调宽保持 `TRANSITION_INSTANT`（duration 0），1:1 跟随指针。

---

## 3. L1：意图表（本规范的主体）

**开发者只选意图，不选数值。** 表按"用户在做什么"组织，而非按参数组织——因为写代码时
想的是「我要做一个抽屉」，不是「我要找一个 220ms」。若表里没有对应意图，
先在本文补一行并在 `/playbook/motion` 落标本，再写实现代码。

| # | 意图 | 类别 | 参数 |
| --- | --- | --- | --- |
| 1 | hover 换底色 | effects | `duration-fast` + `ease-standard` |
| 2 | active 按压 | spatial | 按下 0ms 立即下压，松开 `SPRING_SPATIAL_FAST` |
| 3 | focus-visible ring | effects | `duration-fast` + `ease-standard` |
| 4 | 折叠展开 / 收起 | spatial | `SPRING_SPATIAL_DEFAULT` |
| 5 | 抽屉进 | spatial | `SPRING_SPATIAL_DEFAULT` |
| 6 | 抽屉出 | effects | `duration-base` + `ease-exit`（**退出不弹**，见 §5.3） |
| 7 | 遮罩 scrim 进 / 出 | effects | 进 `base`+`emphasized` / 出 `fast`+`exit` |
| 8 | Popover / 菜单进 | spatial+effects | scale .96→1 `SPRING_SPATIAL_FAST` + opacity `fast` |
| 9 | Tooltip | effects | 延迟 300ms 进 / 0ms 出，淡入 `fast` |
| 10 | Toast 进 / 出 | spatial | 进 `SPRING_SPATIAL_DEFAULT` / 出 `fast`+`exit` |
| 11 | 列表 stagger | — | 40ms/项，**上限 6 项**（超出不再递增延迟） |
| 12 | 路由转场 | spatial | `fadeInUp`（y: 8）+ `base`+`emphasized` |
| 13 | 侧栏 / 面板宽度变化 | spatial | `SPRING_SPATIAL_DEFAULT` |
| 14 | 拖拽跟手 | — | `TRANSITION_INSTANT`（0ms） |
| 15 | 常驻状态指示（进行中） | — | `animate-pulse` / `animate-spin`，**必须有文本或图标语义并行** |
| 16 | 骨架占位 | — | `animate-shimmer`，**禁止永久 Skeleton**（须有终态或错误态） |
| 17 | 营销叙事进入 | spatial | `duration-narrative` + `ease-emphasized`，仅 `(marketing)` |

条目 15 / 16 引自 `design-quality-pitfalls.md` §1.5「状态不可只靠颜色表达」与 §6 数据真值
「禁止永久 Skeleton」。全局 `prefers-reduced-motion` 规则会把这两类动画压到 0.01ms，
若语义只由动画承担，减弱动态后状态即丢失——这是 a11y 缺陷，不是审美问题。

---

## 4. L2：覆盖层内核

### 4.1 结论：平台能力优先（路 B）

不引入 Radix / Base UI。项目已有 46 个自研 UI 组件族登记在 `/playbook`，
再引一套 headless 库等于长期双体系，违反 `AGENTS.md` §3。
改为一个 `OverlayRoot` 内核，两个模式，把 a11y 交给平台：

| 模式 | 底层 | 平台负责 |
| --- | --- | --- |
| `mode="modal"` | `<dialog>` + `showModal()` | top layer、focus trap、背景 inert、ESC |
| `mode="popover"` | `popover="auto"` | top layer、点击外部与 Esc 的 light dismiss、焦点归还、同级互斥关闭 |

两模式共用：scroll lock、§3 的进出场 recipe、内容层动画。

**收益**：`z-40 / z-50 / z-[1000] / z-[1001]` 四个互不相通的层级段全部作废——
top layer 天然位于所有 stacking context 之上，不需要 z-index。
`popover="auto"` 的互斥关闭同时修掉一个现存缺陷：AccountMenu 与 Popover 目前可同时展开，
因为它们互不知情。

### 4.2 必须自己实现的部分（不要假设平台全包）

- **`<dialog>` 不锁背景滚动。** scroll lock 必须自己做，这是平台唯一不覆盖的项。
- **退出动画与 `close()` 的时序。** `close()` 会立即移出 top layer，退出动画来不及播。
  模式：dialog 元素常驻挂载，`open` 变化时命令式 `showModal()`，
  退出在动画完成回调里再 `close()`。
- **CSS anchor positioning 不作为依赖。** 其浏览器支持仍在铺开（Firefox / Safari 支持版本
  很新且资料互相矛盾），定位逻辑留在 JS，锚点定位只作为 `@supports` 渐进增强。
- **Tooltip 不使用 Popover API。** `popover="hint"` 支持度不足。保留 CSS `group-hover`
  结构，补延迟、token 化时长与 `aria-describedby`。
  ⚠️ 已知风险：app-shell 多层 `overflow-hidden`，`absolute` 定位的 tooltip 可能被祖先裁切，
  需实测；若被裁切则升级为 `mode="popover"`。

---

## 5. 禁止事项

### 5.1 数值字面量

禁止在组件中写裸数值绕过 token：

- 禁止 `duration-150` / `duration-200` / `duration-300` 等裸档位；用 §2.2 的四档。
- 禁止手写 `cubic-bezier(...)`；用 §2.3 的三条。
- 禁止 `transition-*` 不带 duration（会吃 Tailwind 默认值，等于隐式引入第五个档位）。
- 禁止 `transition-all`；显式列出过渡属性（`transition-[width]` 等），
  否则会连带过渡 layout 属性，造成不必要的重排。

存量由 `verify:v3` 的 `MOTION_LITERAL` 类别冻结，只允许持平或下降，新增即失败。

### 5.2 效果堆叠

`design-quality-pitfalls.md` §2.3：「渐变+投影+内高光+圆角+动画一次全上，每个 5 分合计 0 分」。
动效侧的具体约束：

- **同屏同时运行的 spring ≤ 2 处**；
- effects 类属性禁止 spring（§2.4）；
- `bounce` 上限 0.25，超过须在 PR 说明理由并附录屏。

### 5.3 退出不弹

退出动画禁止使用 spring。元素离场时 overshoot 会让人以为它要回来，
造成"没关干净"的观感。退出统一走 `ease-exit` + tween。

### 5.4 层级隔离

- `narrative`（300ms）**只允许**在 `src/app/(marketing)` 与 `src/components/marketing` 使用；
  应用壳内使用即为违规。营销层不得拥有独立的 token 文件或第二套 reduced-motion 机制，
  它只是同一张表的另一档。
- Lenis 平滑滚动**只在 `(marketing)` 段生效**；应用壳内禁止，
  它会干扰 `section-nav` 的滚动定位与覆盖层的 scroll lock。
- 动画引擎唯一为 `motion`。禁止为单个组件引入第二个引擎（GSAP 已按此收敛，见 §7）。

### 5.5 reduced-motion

只保留两层，职责不重叠：

1. `globals.css` 的 `@media (prefers-reduced-motion: reduce)` 全局规则——兜 CSS 动画；
2. `<MotionConfig reducedMotion="user">`（`src/lib/motion/config.tsx`）——兜 JS 动画。

禁止第三套自研 Context 或 `matchMedia` 订阅。组件内如需分支判断，
用 `motion/react` 的 `useReducedMotion()`，不要自建 hook。

---

## 6. 交付前自查清单

可直接复制为验收标准。与 `design-quality-pitfalls.md` §3 并用，不重复其颜色 / 对比度条目。

- [ ] 所有时长来自 §2.2 四档，所有曲线来自 §2.3 三条；无裸数值、无手写贝塞尔。
- [ ] 新交互能在 §3 意图表里找到对应行；找不到则先补表 + 补 `/playbook/motion` 标本。
- [ ] `transition-*` 均带显式 duration，且未使用 `transition-all`。
- [ ] spring 只用于 spatial 属性；同屏 spring ≤ 2；退出无 spring。
- [ ] 覆盖层走 `OverlayRoot`，未新增 z-index 层级段。
- [ ] 键盘验证：Tab 焦点不逃出模态、Esc 可关闭、关闭后焦点归还触发元素。
- [ ] 状态类动画有文本或图标语义并行（关掉动画后状态仍可读）。
- [ ] `prefers-reduced-motion: reduce` 下实测：无残留动画，且无信息丢失。
- [ ] 明暗双态 × hover / active / disabled 截图，且为真实路由实物（非仅 demo）。
- [ ] `/playbook/motion` 基线截图已更新；`docs/designs/Design-system-inventory.md` §4.7 索引同批回写。

---

## 7. 存量迁移总账

状态口径：`done` 已迁移 · `todo` 待迁移 · `keep` 现状已合规不动。
逐批推进，每批一个 Conventional Commit。

### 7.1 基础设施

| 项 | 现状 | 目标 | 状态 |
| --- | --- | --- | --- |
| `globals.css` duration 命名空间 | `--duration-*` 生不出 class | `@theme` 加 `--transition-duration-*` | done |
| `lib/motion/tokens.ts` 文档引用 | 指向不存在的 `2026-07-23-design-system-inventory.md §3.8` | 指向本文 | done |
| `lib/motion/tokens.ts` spring | 无 | 补 §2.4 三档 | done |
| `lib/motion/tokens.test.ts` | 只测 JS 侧递增 | 补 CSS↔JS 同步测试 | done |
| `design-system.css` `[data-glow]` | 硬编码 `0.36s cubic-bezier(0.4,0,0.2,1)` | `var(--duration-slow) var(--ease-standard)` | done |
| `fast` token 校准 | 120ms 与全站事实标准 150ms 分叉 | 按 D1 统一为 150ms | done |
| `/playbook/foundations` | 无动效段 | 补 token 对照 | done |
| `/playbook/motion` | 不存在 | §3 意图对照台 | done |

### 7.2 覆盖层（8 套 → 2 模式）

| 组件 | 现状缺陷 | 目标 | 状态 |
| --- | --- | --- | --- |
| `ui/dialog.tsx` | 无动画 / 无 ESC / 无 focus trap / 无 scroll lock | `mode="modal"` | todo |
| `ui/popover.tsx` | 无动画 / 无 ESC；全屏透明 button 兜 dismiss | `mode="popover"` | todo |
| `ui/hover-preview.tsx` | inline `${fadeMs}ms`；手写视口边界 | `mode="popover"`（**保留指针几何**，见下） | todo |
| `navigation/collapsible-panel.tsx` | 唯一做对进出场 | 成为抽屉预设并登记 `/playbook` | todo |
| `ui/tooltip.tsx` | 裸 `transition-opacity`，无 duration 无延迟 | §4.2 方案 | todo |
| `ui/toast.tsx` | 无动画 / 无 viewport / 无 portal / **不自动消失** | 补齐 + `aria-live` | todo |
| `ui/sidebar-chrome.tsx` AccountMenu | 裸 div，零覆盖层能力 | `mode="popover"` | todo |
| `marketing/header.tsx` 移动菜单 | 自写 `duration: 0.2` | `mode="popover"` | todo |
| `ui/context-menu.tsx` | 2026-07-30 新增；自研指针锚定定位 + 自研 light dismiss（进出场已按 §3 意图 8 / §5.3） | `mode="popover"` | todo |

`hover-preview-geometry.ts` 的指针离开方向判定有独立测试，是真实资产，迁移时保留。
迁移会使 `dialog-layering.test.ts` / `popover.test.ts` 失败——它们断言 `createPortal`
与 `z-[1000]` 字符串。这是**预期结果**，须同批改为断言行为而非源码字符串。
ESC 逻辑从 `app-sidebar-shell.tsx`、`canvas-inspector.tsx` 两处删除；
`shot-panels.tsx` 两个漏掉 ESC 的抽屉随之自动补齐。

### 7.3 控件与字面量

| 项 | 现状 | 目标 | 状态 |
| --- | --- | --- | --- |
| `duration-150` × 8 | button / icon-button / toggle / text-field / segmented-control / nav-item / section-nav | `duration-fast` | todo |
| 裸 `transition-colors` × 15+ | 吃 Tailwind 默认值 | 补 `duration-fast` | todo |
| `sidebar-chrome.tsx` AccountMenu 行 | **漏写过渡** | 补意图 1 | todo |
| active 按压 | 仅 `button.tsx` 有（`active:translate-y-px` + `active:brightness-95`，其中 `gray` 变体漏了 brightness）；回弹是 `duration-150` tween 而非 spring。IconButton / NavItem / SegmentedControl / Toggle 无按压态 | 补意图 2 至全部可点控件，回弹换 `SPRING_SPATIAL_FAST` | todo |
| `toggle.tsx` knob | 裸 `transition-transform` | `SPRING_SPATIAL_FAST` | todo |
| `progress-bar.tsx` | `transition-all` | `transition-[width]` | todo |
| `canvas-auto-hide-top-bar.tsx` | `duration-[var(--duration-base)]` + 手写曲线 | `duration-base ease-emphasized` | todo |
| `marketing/faq.tsx` | 体系外曲线 `[0.25,0.46,0.45,0.94]` | `SPRING_SPATIAL_DEFAULT` | todo |

### 7.4 重复体系与死代码

| 项 | 判定依据 | 处理 | 状态 |
| --- | --- | --- | --- |
| `lib/marketing-motion.tsx` | 12 个导出仅文件内部互引；唯一外部 import 是 `providers.tsx` 取 `ReducedMotionProvider`，而读取它的 `useReducedMotion` 零外部消费者（其余均从 `motion/react` 取） | 整文件删除 | todo |
| 同名 `fadeInUp` 冲突 | marketing 版 y:20 vs `variants.ts` y:8 | 随上一条消失 | todo |
| reduced-motion 第三套 | 同上 | 收敛为 §5.5 两层 | todo |
| GSAP `^3.15.0` | 仅 `marketing/image-reveal.tsx` 一个消费者；motion 的 `useScroll` 已在 `text-reveal` / `stats` / `hero` 做同类事；且 GSAP 自带第三套 reduced-motion | 改写后删依赖 | todo |
| Lenis | 与 `globals.css` 全局 `scroll-behavior: smooth` 重复 | 保留但限定 `(marketing)`，收窄全局规则 | todo |
| 侧栏宽度双路径 | `sidebar.tsx` 自带 `transition-[width] duration-200` + `w-[60px]/w-[248px]`，但生产路径外层 `AnimatedAside`（220ms）传入 `w-full` 覆盖了内部宽度类 → 那条 200ms **在生产是死代码，只在 `/playbook` demo 活着** | 宽度动画唯一归 `AnimatedAside`；`sidebar.tsx` 删过渡与宽度类；demo 改用 `AnimatedAside` 包裹 | todo |

### 7.5 已合规（keep）

`products/(app)/template.tsx` 路由转场 · `canvas-view.tsx` summary 进入 ·
`collapsible-card.tsx` · `project-kind-row.tsx` · `project-search-flyout.tsx` ·
`section-nav.tsx` 滚动定位 · `status-pill.tsx`（`animate-pulse` 有文本标签并行，注释已说明）·
`skeleton.tsx` shimmer · `queue-status-bar.tsx` spin。

### 7.6 明确不做

**View Transitions 不引入。** 三个理由：会与 `AnimatePresence` 争夺同批元素的所有权；
本项目跨路由是"右侧内容整体替换"，无共享元素需求，而共享元素正是 VT 的主要收益；
`template.tsx` 现有方案已达标。若将来引入，**必须先下线 `template.tsx` 的 `fadeInUp`**，
二者不可并存。

---

## 8. 与其他文档的关系

| 文档 | 边界 |
| --- | --- |
| 本文 | 动效数值、意图表、覆盖层内核、动效禁止事项的唯一文字真值 |
| `design-quality-pitfalls.md` | 颜色 / 对比度 / 光影 / 密度的失败模式。动效侧只引用其 §1.5、§2.3、§6，不重复 |
| `docs/designs/Design-system-inventory.md` §4.7 | 只保留指向本文的索引，不重复参数 |
| `docs/designs/canvas.pen` | 静态像素真值。**不含动效**，动效不从 Pencil 推导 |
| `routing.md` §2.4 | `/playbook/motion` 的路由登记与"文档改动须同批落标本"的约束 |
| `src/lib/motion/tokens.ts` | 本文 §2 的 JS 镜像，由同步测试锁定 |
| `docs/plans/motion-interaction/` | 把本文 §7 的 `todo` 拆成 9 个编号批次的执行计划。**本文是规范（做什么对），计划是排期（按什么顺序做）**；两者冲突时以本文为准，并同批修正计划 |
