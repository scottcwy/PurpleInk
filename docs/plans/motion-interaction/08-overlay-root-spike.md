# 08 · `OverlayRoot` 平台能力 spike

- 前置：**D6 阻塞** —— 必须等画布右键菜单相关工作收尾。执行前确认
  `src/app/products/(app)/canvas/**` 与 `src/components/ui/context-menu*` 无未提交改动
- 消掉意图：无（这是一次只读验证，不改产品代码）
- 共用硬边界与验证清单见 `00-README.md` §0
- 决策依据：`00-README.md` D2、D7

## 1. 目标与非目标

**目标**：在真实 Chromium 里回答四个问题，然后再决定 09 怎么写。
不带结论开工是本计划风险最高的做法。

**非目标**：不改任何生产组件。spike 产物是一份结论 + 一个可丢弃的原型。

## 2. 为什么必须先 spike

09 要迁移 9 套覆盖层、影响 5 个 Dialog 消费者，是整个计划里最不可逆的一批。
而路 B 的三条平台能力里，只有 `<dialog>` + `showModal()` 是长期稳定的
（2022 年起 widely available）；另外两条各有不确定性：

- `popover="auto"` 是 Baseline **newly available**（2025 初），
  在 iOS 上曾有 light dismiss 缺陷的历史；
- `@starting-style` + `transition-behavior: allow-discrete` 与 React 的
  挂载/卸载时序如何配合，没有现成答案；
- **CSS anchor positioning 已明确不作为依赖**（D7），所以定位必须自己做，
  这直接决定 `OverlayRoot` 的 API 形状。

## 3. 四个待验问题

### 3.1 `<dialog>` 的退出动画时序

`close()` 会立即把元素移出 top layer，退出动画来不及播。

待验：**dialog 元素常驻挂载 + 命令式 `showModal()` + 在动画完成回调里 `close()`**
这个模式是否可靠。具体要试出：

- `AnimatePresence` 是否还有必要，或者用 `motion` 的 `onAnimationComplete` 直接驱动更简单；
- 快速连续开关（点两下）时是否出现状态错乱或 dialog 卡在 open；
- `showModal()` 在元素已 open 时再次调用是否抛错，需不需要守卫。

**备选方案**：若命令式路径太脆，改用 `@starting-style` + `allow-discrete` 纯 CSS 进出场，
代价是 L1 recipe 的参数要在 CSS 侧再写一份（违反单一真值），需要权衡后记录。

### 3.2 scroll lock 必须自己做（已知，验证实现方式）

`<dialog>` **不锁背景滚动**。这是平台唯一不覆盖的项，规范 §4.2 已写明。

待验：在本项目的布局下用哪种方式。注意 app-shell 是
`h-screen w-screen overflow-hidden` + 内部滚动容器，**不是 body 滚动**——
所以常见的 `document.body.style.overflow = 'hidden'` 方案可能根本无效。
要找出真正的滚动容器并验证锁定有效，同时不产生布局跳动（滚动条消失导致的宽度变化）。

### 3.3 `popover="auto"` 的焦点归还与互斥

待验：

- 打开→关闭后焦点是否自动回到触发元素（规范 §4.1 声称平台负责，需实测）；
- 同级互斥关闭是否生效——这决定能否修掉「AccountMenu 与 Popover 可同时展开」的现存缺陷；
- 与 `ContextMenu` 现有的手写 light dismiss 是否冲突（见 §4）；
- Esc 关闭后事件是否会继续冒泡影响外层（例如同时关掉一个模态）。

### 3.4 Tooltip 会不会被 `overflow-hidden` 裁切

`ui/tooltip.tsx` 是 `absolute` 定位，而 app-shell 多层
`overflow-hidden`（`app-shell.tsx` 的外层与内容区都有）。

待验：在真实应用页面（不是 playbook）里把 tooltip 放在靠边缘的控件上，
看是否被祖先裁切。

- 若**不裁切**：按规范 §4.2 保留 CSS `group-hover` 方案，只补延迟与 `aria-describedby`；
- 若**裁切**：Tooltip 必须升级为 `mode="popover"`，09 的范围扩大。

## 4. `ContextMenu` 是本 spike 最有价值的参照物

并行工作产出的 `src/components/ui/context-menu.tsx` 目前是全仓库 a11y 最完整的覆盖层，
且**完全符合动效规范**。它已经实现了：

- portal 到 `document.body`；
- light dismiss：外部指针、Escape、Tab、滚动、resize、窗口失焦；
- `role="menu"` / `menuitem` / `separator`、`aria-label`；
- 上下键 roving focus、关闭后焦点归还触发元素；
- 落位几何拆成纯函数 `context-menu-placement.ts` 并有单测（4 例）；
- `z-[1001]`，**复用既有层级段，没有新开一段**。

它是手写实现（未用 Popover API）。spike 要回答的是：**`popover="auto"` 能替掉它多少手写代码？**

- 如果能替掉 dismiss + 焦点归还，`OverlayRoot` 就有明确价值；
- 如果替不掉多少（例如仍要自己处理 roving focus 和定位），
  那 `OverlayRoot` 更应该做成**把 ContextMenu 已验证的这套逻辑抽出来复用**，
  而不是押在 Popover API 上。

**这是一个真实的分支点，spike 之后 09 的形态可能与规范 §4.1 的描述不同。
若结论不同，先改规范再写 09。**

## 5. 执行方式

1. 在 `docs/artifacts/` 或 `.data/` 下建一个**可丢弃**的 spike 页面
   （不注册进 `routing.md`，不进 `/playbook`，spike 结束即删除）。
   若需要临时路由，用 `.data/` 下的独立 HTML + Playwright 更干净。
2. 逐条验证 §3 的四个问题 + §4 的分支点。
3. 键盘与读屏路径都要走：Tab / Shift+Tab / Esc / 方向键。
4. 把结论写回**本文档 §7**，并按结论更新 `motion-interaction.md` §4。
5. 删除 spike 产物。

## 6. 验证

spike 本身没有"通过"，只有"得出结论"。完成标准是 §7 的五个问题**全部有实测答案**，
且每个答案附证据（截图 / 录屏 / 控制台输出）。

**不允许把"应该可以"写成结论。** 规范 §4 已经因为我引用了一篇不可靠的博客而
在锚点定位上出过一次错（后由 D7 更正），同类错误不要再发生。

## 7. 结论记录（执行时填写）

| # | 问题 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | `<dialog>` 退出动画时序用哪个模式 | **常驻挂载 + 命令式 `showModal()` + 退出完成后 `close()`**。`showModal()` 前守卫 `dialog.open`；重新打开时取消待执行的 close 并清退出态。无需 `AnimatePresence` 卸载 dialog，内容层用 Motion phase / `onAnimationComplete` 即可。 | Chromium 151：退出 60ms 时 `open=true`、opacity 约 0.36，180ms 后关闭；close→40ms→open 连击后 `open=true`、无 closing、无异常。截图 `output/playwright/motion-08-dialog-exit.png`。 |
| 2 | scroll lock 在本项目布局下怎么实现 | `body` lock **无效**；锁触发元素所在的最近 `[data-overlay-scroll-root]`（允许显式 ref 覆盖），保存并恢复原 overflow。容器使用 `scrollbar-gutter: stable` 防跳动。 | body hidden 时内部 `scrollTop 400→640`；真实根加锁后 `640→640`；`clientWidth 1043→1043`。 |
| 3 | `popover="auto"` 的焦点归还 / 互斥是否可靠 | 平台的 Esc、指针 light dismiss、同级互斥和 Esc 后焦点归还可靠；指针外点关闭后焦点落在实际点击目标（本例 `BODY`），不应强抢回触发器。Tab / Shift+Tab 顺序正确；平台**不提供** menu role、方向键 roving 或定位。嵌套在 dialog 时第一次 Esc 只关 popover，第二次才关 dialog。 | Tab→`item-one`，Shift+Tab→`trigger-one`；Esc→trigger；A/B 状态 `false/true`；ArrowDown 仍停 `item-one`；dialog/popover 两级 Esc 状态正确。截图 `output/playwright/motion-08-popover-stack.png`。 |
| 4 | Tooltip 是否被 `overflow-hidden` 裁切 | **会裁切，09 必须纳入。** 使用 `mode="popover"` 的 manual dismissal 进入 top layer，hover/focus 自己控制，不用尚不稳定的 `popover="hint"`。 | 真实 `/products/settings`：侧栏裁切根 `overflow=hidden`、右边界 248px，Tooltip 几何右边界 307.7px，越界探针命中其它元素。截图 `output/playwright/motion-08-tooltip-clipped.png`。 |
| 5 | `OverlayRoot` 应基于 Popover API 还是抽取 `ContextMenu` 的既有逻辑 | **混合方案，以平台 Popover API 为底座。** 平台接管 top layer / dismiss / Esc / 互斥；从 `ContextMenu` 保留并抽出 JS 定位、role/menuitem 语义、roving focus 与焦点策略。删除与原生 dismiss 重复的监听，不推翻 `context-menu-placement.ts`。 | Chromium 151 原型无 console/page errors；平台能力与缺口分别由第 3 行的互斥、焦点、ArrowDown 和 role 结果证明。 |

## 8. 完成判据

- [x] 五个问题均有实测结论与证据；
- [x] 结论已写回本文档 §7；
- [x] 结论与原 `motion-interaction.md` §4 的差异已先行更新；
- [x] spike HTML / 脚本已删除，生产代码无改动；
- [x] 09 已确定采用平台 + `ContextMenu` 能力的混合方案，并纳入 Tooltip；
- [x] 单个 Conventional Commit（只含文档与规范更新，无产品代码改动）。
