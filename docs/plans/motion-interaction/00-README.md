# 动效统一迁移计划 · 总览（面向执行 AI）

- 计划性质：把散落的动效实现收敛到 `docs/conventions/motion-interaction.md` 的单一真值
- 撰写日期：2026-07-30
- 审查基线：`yusheng/two-part-merge`，起点提交 `5771588`
- 上游真值：`AGENTS.md`、`docs/conventions/motion-interaction.md`（动效唯一文字真值）、
  `docs/conventions/design-quality-pitfalls.md`、`docs/designs/Design-system-inventory.md` §4.7、
  `/playbook/motion`（意图标本）、`/playbook/foundations`（token 对照）
- 并行计划：`PLAN-001`（部署边界）、`PLAN-002`（登录体系）—— 文件级不相交
- 前置已完成：token 消费路径已打通（`4a7b9db`）、规范已落盘（`5fc2f6f`）、
  对照台已上线（`8830f7a`）、Tailwind 扫描面已收窄（`5771588`）

## 0. 读前必读

### 0.1 本计划要解决什么

规范与对照台已经存在，但 `motion-interaction.md` §7 迁移总账里 13 条意图仍是 `todo`。
本计划把这些 `todo` 拆成 9 个可独立验证、可独立回滚的批次，按执行顺序编号。

**每个批次一个文档，一个 Conventional Commit。** 不允许跨批次混提交——
批次边界就是回滚边界。

### 0.2 硬边界（越界即失败，全批次共用）

1. **不改分支。** 保持 `yusheng/two-part-merge`（`AGENTS.md` 开头）。
2. **不 push、不建 PR、不 force push、不 `--amend` 已推送提交、不 `--no-verify`。**
3. **只 stage 当前批次职责内的文件**，禁止 `git add .`。本分支有并行工作，
   工作区可能出现不属于本计划的改动（已实测发生过），提交前必须 `git status --porcelain` 核对。
4. **不新增动效数值真值。** 时长只用 `fast|base|slow|narrative`，曲线只用
   `standard|emphasized|exit`，弹性只用 `SPRING_SPATIAL_*`。需要新档位先改规范 §2 再改代码。
5. **不套 re-export 壳规避规模门禁。** 碰到 350 行硬上限，在**当前批次内**按真实职责拆分
   （`AGENTS.md` §5）。本轮已有先例：`intent-specimens.tsx` 381 行被门禁拦下，
   拆成 controls / overlays / layout 三个标本文件 + 一个登记映射。
6. **不把新超限文件写进 `verify:v3` baseline 掩盖门禁。**
7. **规范与实现同批回写。** 改了参数就改 `motion-interaction.md` §7 的状态列，
   改了意图就同批更新 `/playbook/motion` 标本（`routing.md` §2.4 的约束）。
8. **禁止把 `pending` 标成 `unified`。** 对照台的状态列是真实迁移进度，
   `motion-intents.test.ts` 已锁住「pending 必须写明生产现状、unified 不得携带现状」。

### 0.3 全批次共用验证清单

每批次提交前至少执行：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm verify:v3
pnpm build
git diff --check
```

涉及用户可见变化的批次（03 / 04 / 05 / 06 / 09）追加：

- 真实 Chromium 亮/暗双态截图，与 02 建立的基线比对；
- `prefers-reduced-motion: reduce` 下实测无残留动画且无信息丢失；
- 键盘验证：Tab 顺序、`focus-visible` 可见、Esc 行为。

**已知抖动**：`src/lib/queue/init.test.ts` 的 Redis 单例在满载并行下会 5s 超时
（四次全量跑里出现两次，单独重跑必过）。与本计划无关，遇到重跑该文件确认即可，
不要为它改动 queue 代码。

### 0.4 已记录的决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D1 | `fast` 定为 **150ms**，不是 120ms | 让规范适配现状而非反过来。统一比具体数值更重要；且使 03 批次的绝大部分变成零视觉差异（见 01 与 03） |
| D2 | 覆盖层走**路 B**（`<dialog>` + `popover="auto"`），不引 Radix / Base UI | 项目已有 47 个自研 UI 组件族登记在 `/playbook`，引 headless 库等于长期双体系，违反 `AGENTS.md` §3 |
| D3 | **GSAP 真删**，改用 motion 的 `useScroll` | 唯一消费者是 `marketing/image-reveal.tsx`；为一个组件养第二个动画引擎不划算，且它自带第三套 reduced-motion |
| D4 | Lenis **保留**但限定 `(marketing)` | motion 无等价能力，但它与全局 `scroll-behavior: smooth` 重复，且会干扰滚动定位与覆盖层 scroll lock |
| D5 | **不引入 View Transitions** | 会与 `AnimatePresence` 争夺元素所有权；本项目跨路由是内容整体替换，无共享元素需求 |
| D6 | 覆盖层迁移（08/09）**必须等画布右键菜单相关工作收尾后再开始** | 避免与并行任务冲突；Dialog 有 5 个消费者，ContextMenu 属覆盖层 |
| D7 | 锚点定位（CSS anchor positioning）**不作为依赖** | 浏览器支持仍在铺开，资料互相矛盾；定位逻辑留在 JS，锚点定位只作 `@supports` 渐进增强 |

## 1. 执行顺序与依赖

| # | 文档 | 批次 | 消掉的意图 | 视觉风险 | 阻塞条件 |
| --- | --- | --- | --- | --- | --- |
| 01 | `01-token-recalibration.md` | `fast` 校准为 150ms | — | 极低 | 无，可立即开始 |
| 02 | `02-visual-baseline.md` | 视觉回归基线设施 | — | 无（只读） | 01 完成（基线要含校准后的值） |
| 03 | `03-control-state-unification.md` | 控件状态层 | 1 / 2 / 3 | 低（多数零差异） | 02 完成 |
| 04 | `04-curve-literal-convergence.md` | 曲线与时长字面量 | 4 / 17 | 中 | 02 完成 |
| 05 | `05-dead-code-cleanup.md` | 死代码与重复体系 | — | 低 | 04 完成（同批营销页验证） |
| 06 | `06-gsap-retirement.md` | GSAP 下线 + Lenis 收窄 | — | 中高 | 05 完成 |
| 07 | `07-motion-literal-gate.md` | `MOTION_LITERAL` 门禁 | — | 无 | 03 + 04 完成 |
| 08 | `08-overlay-root-spike.md` | 平台能力 spike | — | 无（只读验证） | **D6：画布菜单工作收尾** |
| 09 | `09-overlay-root-migration.md` | 覆盖层迁移 | 5 / 6 / 8 / 9 / 10 | 高 | 08 出结论 |

### 1.1 硬依赖（顺序不可调）

- **01 必须在 03 之前。** `fast` 还是 120ms 时，`duration-150 → duration-fast` 是有视觉差异的改动；
  校准为 150ms 后它是零差异重命名。这是 03 能用"零差异"作为验证门槛的前提。
- **02 必须在 03 / 04 / 05 / 06 之前。** 这四批都改可见观感，没有基线就无法证明"只改了该改的"。
  本轮已实测过一次教训：`duration-[var(...)]` 污染样式表导致页面 500，
  而 `lint` / `typecheck` / `test` / `verify:v3` / `build` **全部通过**，只有真实浏览器暴露。
- **07 必须在 03 和 04 之后。** 门禁用 baseline cap 冻结存量；现在冻结等于把待修的债合法化。
- **09 必须在 08 出结论之后**，且受 D6 阻塞。

### 1.2 为什么 05 排在 04 之后而不是最前面

05 风险最低，但它和 04、06 都改营销页。三批相邻只需一轮营销页截图验证，分散做要三轮。

## 2. 意图状态追踪

`/playbook/motion` 的状态列是唯一真值，本表只作规划期索引。起点状态（`5771588`）：

| 意图 | 状态 | 由哪批消掉 |
| --- | --- | --- |
| 1 hover 换底色 | pending | 03 |
| 2 active 按压 | pending | 03 |
| 3 focus-visible ring | pending | 03 |
| 4 折叠展开 | pending | 04 |
| 5 抽屉进 | pending | 09 |
| 6 抽屉出 | pending | 09 |
| 7 遮罩 scrim | **unified** | — |
| 8 Popover / 菜单进 | pending（部分：`ContextMenu` 已合规） | 09 |
| 9 Tooltip | pending | 09 |
| 10 Toast | pending | 09 |
| 11 列表 stagger | pending | 未排期，见 §3 |
| 12 路由转场 | **unified** | — |
| 13 侧栏 / 面板宽度 | pending | 未排期，见 §3 |
| 14 拖拽跟手 | **unified** | — |
| 15 状态指示 | **unified** | — |
| 16 骨架占位 | **unified** | — |
| 17 营销叙事进入 | pending | 04 |

全部批次完成后：13 条 unified，剩 11 与 13 两条待定。

## 3. 本计划范围外（明确不做）

- **意图 11（列表 stagger）**：应用层目前没有需要 stagger 的列表。等真实场景出现再排期，
  不为它先造一个用法。
- **意图 13（侧栏 / 面板宽度换 spring）**：`AnimatedAside` 现在用 tween 220ms，
  换 `SPRING_SPATIAL_DEFAULT` 是纯观感偏好，收益不明确。等 03 的 `SPRING_SPATIAL_FAST`
  在真实控件上跑过、对弹性手感有判断之后再决定。05 只清理它的**死代码分支**
  （`sidebar.tsx` 那条在生产路径已失效的 `transition-[width] duration-200`），不改参数。
- **视频渲染侧动效**：`src/features/render/__fixtures__/*.html` 与 HyperFrames 产物受
  确定性红线约束，与应用 UI 动效是两套体系，本计划完全不触及。

## 4. 待补充的规范空缺

执行 01 时会发现一处：`motion-interaction.md` §1 现在写着「`duration-150` 出现 8 处，
而体系三档是 120 / 220 / 360——150 不属于任何一档」。`fast` 校准为 150ms 后这句话变成**错的**，
必须在 01 批次内改写。这类文档真值漂移要当缺陷处理，不是文字润色。
