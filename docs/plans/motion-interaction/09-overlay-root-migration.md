# 09 · `OverlayRoot` 内核与 9 套覆盖层迁移（意图 5 / 6 / 8 / 9 / 10）

- 前置：08 出结论（§7 五问全部填写）；02 基线可用；**D6 阻塞**同 08
- 消掉意图：5（抽屉进）、6（抽屉出）、8（Popover / 菜单进）、9（Tooltip）、10（Toast）
- 共用硬边界与验证清单见 `00-README.md` §0

## 1. 目标与非目标

**目标**：一个 `OverlayRoot` 内核 + 两个模式，9 套覆盖层全部成为它的消费者。
连带补齐目前集体缺失的 a11y 能力，并作废四段互不相通的 z-index。

**非目标**：不引入 Radix / Base UI（D2）；不依赖 CSS anchor positioning（D7）；
不改覆盖层的**视觉外观**（圆角、边框、阴影、内间距一律保持），只改行为与动效。

**这是整个计划里最不可逆的一批。** 它拆成 5 个提交，见 §5。

## 2. 迁移前必须重新点名

规划期记录的是 8 套，并行工作新增 `ContextMenu` 后是 **9 套**。
执行前重新确认清单与各自能力现状：

```powershell
Select-String -Path src/**/*.tsx -Pattern 'createPortal'
Select-String -Path src/**/*.tsx -Pattern 'z-\[?(40|50|1000|1001)'
```

| # | 组件 | 现状缺陷 | 目标模式 |
| --- | --- | --- | --- |
| 1 | `ui/dialog.tsx` | 无动画 / 无 ESC / 无 focus trap / 无 scroll lock；`z-[1000]` | `modal` |
| 2 | `ui/popover.tsx` | 无动画 / 无 ESC；用全屏透明 `button` 兜 dismiss；1000/1001 | `popover` |
| 3 | `ui/hover-preview.tsx` | inline `${fadeMs}ms`；手写视口边界 | `popover`（**保留指针几何**，见 §3.2） |
| 4 | `ui/tooltip.tsx` | 裸 `transition-opacity`，无时长无延迟 | 取决于 08 §3.4 结论 |
| 5 | `ui/toast.tsx` | 无动画 / 无 viewport / 无 portal / **不自动消失** | 见 §3.3 |
| 6 | `ui/sidebar-chrome.tsx` AccountMenu | 裸 div，零覆盖层能力 | `popover` |
| 7 | `ui/context-menu.tsx` | **已合规**，是参照物 | 见 §3.1 |
| 8 | `navigation/collapsible-panel.tsx` DrawerOverlay | 进出场做对了；ESC 由调用方各写一遍 | 抽屉预设 |
| 9 | `marketing/header.tsx` 移动菜单 | 自写 `duration: 0.2`；`z-40` | `popover` |

### 2.1 Dialog 的 5 个消费者（迁移的真实影响面）

`features/auth/login-required-dialog.tsx`、`app/_components/new-project-dialog.tsx`、
`settings/custom-openai-asr-section.tsx`、`canvas/[projectId]/skip-node-dialog.tsx`、
`canvas/[projectId]/stage-error-dialog.tsx`。

理想情况这 5 个**零改动**继承 ESC / focus trap / scroll lock。
若 `OverlayRoot` 的 API 与现有 `Dialog` props 不兼容，说明 API 设计错了——
先调 API，不要改 5 个消费者。

## 3. 几个需要判断而非照抄的点

### 3.1 `ContextMenu` 怎么处理

它已经合规且是全仓库最完整的覆盖层。**不要为了"统一"把它推翻重写。**

按 08 §7 第 5 问的结论二选一：

- 若 `OverlayRoot` 基于 Popover API 且能替掉手写 dismiss —— `ContextMenu` 改为消费它，
  保留 `context-menu-placement.ts`（纯函数 + 4 例单测，是真实资产）；
- 若 `OverlayRoot` 是抽取既有逻辑 —— **以 `ContextMenu` 为蓝本**抽出内核，
  它反而是第一个"已经在用"的消费者，改动最小。

### 3.2 `hover-preview` 的指针几何要保留

`hover-preview-geometry.ts` 的「离开方向是否朝向面板」判定有独立单测，
是解决真实体验问题（斜向移动到面板时不误关）的资产。
迁移只换定位与进出场，**不要连带删掉这套几何**。

### 3.3 Toast 是补功能，不只是迁移

它是 9 套里唯一**功能都没做完**的：没有 viewport（多条 toast 无处堆叠）、
没有 portal、不会自动消失、没有 `aria-live`。

这意味着 Toast 那一步的工作量接近"新写一个组件"，
且**不自动消失是一个用户可见的功能缺陷**，不是动效问题。
建议它单独一个提交，不与其它覆盖层混在一起。

### 3.4 z-index 收敛的验证方式

迁移到 top layer 后应当不再需要 z-index。但 `z-40` / `z-50` 也用在非覆盖层元素上
（如 `canvas-auto-hide-top-bar` 的 `z-40`、IconButton 的 `fixed left-2 top-2 z-40`）。

**判据不是"z-index 全部消失"，而是"覆盖层不再依赖 z-index 分层"。**
验证方式：在画布页（有 `z-30/z-40` 的自动隐藏顶栏）打开 Dialog 与 ContextMenu，
确认层叠正确，且不需要为它们调任何 z 值。

### 3.5 会失败的既有测试（预期）

- `src/components/ui/dialog-layering.test.ts` 断言源码含 `createPortal` / `document.body` / `z-[1000]`；
- `src/components/ui/popover.test.ts` 断言含 `role="dialog"` / `createPortal` / `z-[1000]`。

迁移后这些字符串会消失。**这是预期结果，要同批把它们改成断言行为而非源码字符串**
（例如渲染后断言元素在 top layer、Esc 可关闭、焦点归还）。
禁止为了让测试通过而保留无用的 `z-[1000]`。

### 3.6 ESC 重复实现要一起删

`features/navigation/app-sidebar-shell.tsx` 与
`canvas/[projectId]/canvas-inspector.tsx` 各自写了一遍抽屉 ESC 监听，
而 `shots/[shotId]/shot-panels.tsx` 的两个抽屉**漏了**。
内核接管后删除前两处，第三处自动补齐。

## 4. 内核形态（供实现参考，非硬约束）

```
OverlayRoot mode="modal"     → <dialog> + showModal()
  平台负责：top layer / focus trap / 背景 inert / ESC
  自己负责：scroll lock（08 §3.2 的结论）、进出场（08 §3.1 的结论）

OverlayRoot mode="popover"   → popover="auto"（或抽取 ContextMenu 逻辑）
  平台/内核负责：top layer / light dismiss / 焦点归还 / 同级互斥
  自己负责：定位（JS，D7）、进出场
```

两模式共用：L1 recipe 参数（意图 5-10）、portal、进出场编排。

规模注意：内核容易膨胀到 350 行以上。**定位、dismiss、focus 管理、动效编排**
是四个不同的变化原因，从一开始就分文件，不要等门禁拦下来再拆
（03 / `intent-specimens` 已经各踩过一次）。

## 5. 提交切分

| 提交 | 内容 | 可否单独回滚 |
| --- | --- | --- |
| 09-1 | `OverlayRoot` 内核 + 单测 + 登记 `/playbook`（无消费者切换） | 是 |
| 09-2 | Dialog 迁移 + 改写 `dialog-layering.test.ts` | 是 |
| 09-3 | Popover / HoverPreview / AccountMenu / 营销移动菜单 + 改写 `popover.test.ts` | 是 |
| 09-4 | DrawerOverlay 预设 + 删两处重复 ESC + 补 `shot-panels` | 是 |
| 09-5 | Toast 补齐（viewport / portal / 自动消失 / `aria-live`） | 是 |

`ContextMenu` 与 Tooltip 按 08 结论插入对应提交，或明确记为不动。

**每个提交后都要跑基线 + 键盘验证**，不要攒到最后一起验。

## 6. 验证

每个提交至少：

- **键盘**：Tab / Shift+Tab 不逃出模态；Esc 关闭；关闭后焦点回到触发元素；
  菜单类支持方向键；
- **scroll lock**：模态打开时背景（含 app-shell 的内部滚动容器）不可滚动，
  且无布局跳动；
- **层叠**：§3.4 的画布页组合场景；
- **动效**：进出场符合意图 5/6/8/9/10 的参数，退出无 spring（规范 §5.3）；
- **`reduced-motion`**：进出场压平但覆盖层仍可正常开关；
- 明暗双态截图 + 基线比对；
- 共用清单全套 + `pnpm verify:motion`。

`/playbook/motion` 的意图状态在**对应提交内**更新，不要提前标 `unified`。

## 7. 风险与回滚

**风险 1（最高）：与并行工作冲突。** D6 已要求等画布菜单收尾，但 Dialog 的 5 个消费者
分布在 auth / settings / canvas 三处。每个提交前 `git log --oneline -5` +
`git status --porcelain` 确认，并优先做与并行工作距离最远的部分（09-1 / 09-5）。

**风险 2：`<dialog>` 与 React 受控状态的时序**。若 08 §3.1 未能给出可靠模式，
**不要硬上**——退化方案是保留现有 portal 实现，只补 ESC / focus trap / scroll lock
三项能力（意图 5/6/8/9/10 的动效仍可统一）。这样收益从"平台接管 a11y"降级为
"手写但统一"，但不阻塞其余批次。这个降级是可接受的，写进规范 §4 即可。

**风险 3：DrawerOverlay 是目前唯一做对的实现**，迁移它有把好的改坏的风险。
它排在 09-4 而非更早，就是为了先在其它组件上把内核跑顺。

**回滚**：五个提交独立。若 09-2 出问题，revert 它不影响 09-1 的内核存在。

## 8. 完成判据

- [ ] `OverlayRoot` 已登记 `/playbook`，`DrawerOverlay` / `AnimatedAside` 同批补登记；
- [ ] 9 套覆盖层已按 08 结论各自处理（迁移 / 保留 / 记录例外），无遗漏；
- [ ] Dialog 的 5 个消费者零改动或 API 已调整（未反向改消费者）；
- [ ] `dialog-layering.test.ts` / `popover.test.ts` 已改为断言行为；
- [ ] 两处重复 ESC 已删，`shot-panels` 的两个抽屉已具备 ESC；
- [ ] Toast 具备 viewport / portal / 自动消失 / `aria-live`；
- [ ] 覆盖层不再依赖 z-index 分层（§3.4 的组合场景实测）；
- [ ] 意图 5 / 6 / 8 / 9 / 10 标为 `unified`；
- [ ] `motion-interaction.md` §4 与 §7.2 已回写（含任何降级决策）；
- [ ] 五个 Conventional Commit。
