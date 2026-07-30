# 05 · 死代码与重复体系清理

- 前置：04 完成（同批营销页验证，见 `00-README.md` §1.2）
- 消掉意图：无（纯减法批次）
- 共用硬边界与验证清单见 `00-README.md` §0

## 1. 目标与非目标

**目标**：删掉 `src/lib/marketing-motion.tsx` 整个文件、消除同名 variants 冲突、
把 reduced-motion 从三套收敛到两套、清掉侧栏宽度的死代码分支。

**非目标**：不改任何可见行为。本批次理想结果是**基线零差异**——
如果出现差异，说明删掉的东西并非死代码，要停下来重新判断。

## 2. 为什么判定 `marketing-motion.tsx` 是死代码

规划期已逐个 grep 全部 12 个导出名，结论：

- `fadeIn` / `fadeInUp` / `fadeInDown` / `scaleIn` / `staggerContainer` /
  `reducedMotionVariants` / `defaultTransition` / `springTransition` /
  `MotionDiv` / `MotionSection` / `StaggerContainer` / `StaggerItem`
  —— **全部只在该文件内部互相引用**，无任何外部消费者；
- 唯一的外部 import 是 `src/components/marketing/providers.tsx` 取 `ReducedMotionProvider`；
- 而读取该 Provider 的 `useReducedMotion` **零外部消费者**——
  `section-nav.tsx` 与 `launch-composer.tsx` 都是从 `motion/react` 取的同名 hook。

所以这个文件塌缩成一个"挂着但没人读"的 no-op Provider。删除它同时解决三个问题：

1. **同名冲突**：该文件的 `fadeInUp` 位移是 `y: 20`，而 `src/lib/motion/variants.ts`
   的同名导出是 `y: 8`。两个 `fadeInUp` 语义不同，是 `AGENTS.md` §3 明令禁止的
   「为同一职责增加平行 wrapper」。
2. **第三套 reduced-motion**：它用 `matchMedia` + `useSyncExternalStore` 自建了一套，
   而全站已有两套职责不重叠的机制（见 §3.2）。
3. **平行 token**：它的 `defaultTransition`（0.3 + standard）与 `springTransition`
   （stiffness 300 / damping 30）是体系外的第二份动效参数。

**执行前必须重跑一次 grep 确认**（并行工作可能新增了消费者）：

```powershell
Select-String -Path src/**/*.ts,src/**/*.tsx -Pattern 'marketing-motion'
Select-String -Path src/**/*.tsx -Pattern '(MotionDiv|MotionSection|StaggerContainer|StaggerItem)'
```

## 3. 精确范围

### 3.1 删除

| 文件 | 动作 |
| --- | --- |
| `src/lib/marketing-motion.tsx` | 整文件删除 |
| `src/components/marketing/providers.tsx` | 移除 `ReducedMotionProvider` 的 import 与包裹 |

### 3.2 reduced-motion 收敛为两层

保留（职责不重叠）：

1. `src/app/globals.css` 的 `@media (prefers-reduced-motion: reduce)` 全局规则
   —— 兜 **CSS** 动画，把 `animation-duration` / `transition-duration` 压到 0.01ms；
2. `src/lib/motion/config.tsx` 的 `<MotionConfig reducedMotion="user">`
   （挂在 `src/app/layout.tsx`，**已覆盖全站含营销页**）—— 兜 **JS** 动画。

删除第三层（`marketing-motion.tsx` 的 Context）。
关键前提：`MotionConfig` 挂在根 layout，营销页在其覆盖范围内，所以删掉不会让营销页
失去 reduced-motion 支持。**这一点必须在浏览器里实测确认**，不能只靠读代码（见 §5）。

组件内如需分支判断，用 `motion/react` 的 `useReducedMotion()`——
`section-nav.tsx` 与 `launch-composer.tsx` 已是这个用法，作为参照。

### 3.3 侧栏宽度死代码

`src/components/ui/sidebar.tsx` 的 aside 上有
`transition-[width] duration-200` + `collapsed ? 'w-[60px]' : 'w-[248px]'`。

生产路径上 `AppSidebarShell` 用 `AnimatedAside`（motion，220ms）包裹它并传入
`className="h-full w-full"`，`w-full` 覆盖了内部宽度类 —— **那条 200ms 过渡在生产是死代码，
只在 `/playbook` 的 `sidebar.demo.tsx` 里还活着**。这就是"SSOT 组件一个数、
生产路径另一个数"的来源。

处理：
- `sidebar.tsx` 删掉 `transition-[width] duration-200` 与两个宽度类，宽度完全由容器决定；
- `sidebar.demo.tsx` 改用 `AnimatedAside` 包裹，让 `/playbook` 展示的就是生产结构。

**不改** `AnimatedAside` 的参数（仍是 `TRANSITION_BASE`）。换 spring 属意图 13，
`00-README.md` §3 已明确不在本计划范围。

### 3.4 顺带清理

`src/app/globals.css` 的 `html { scroll-behavior: smooth }` 与 Lenis 重复。
**本批次不动它**——它归 06（Lenis 收窄）一起处理，避免两批都碰滚动行为。

## 4. 执行步骤

1. 重跑 §2 的 grep 确认死代码判定仍成立。若发现新消费者，**停止并重新评估**，
   不要为了删文件而先改消费者。
2. 删 `marketing-motion.tsx`，改 `providers.tsx`。
3. `pnpm typecheck` —— 这是本步最有效的保护，任何遗漏引用会直接报错。
4. 处理 §3.3 的侧栏死代码。
5. 跑基线，**要求零差异**。
6. 回写 `motion-interaction.md` §7.4 的状态列（三行：死代码、同名冲突、侧栏双路径）。

## 5. 验证

- **基线零差异**是本批次的核心判据；
- **营销页 reduced-motion 实测**：开启系统"减弱动态效果"后访问 `/`，
  确认入场动画、视差、carousel 均被压平。这一步验证的是"删掉第三套之后
  `MotionConfig` 确实覆盖了营销页"，**不能省，也不能只读代码推断**；
- `/playbook/ui` 的 `sidebar` 条目仍能正常展开收起（demo 改了结构）；
- 应用壳侧栏在三态（expanded / rail / hidden drawer）下切换正常，宽度动画仍来自
  `AnimatedAside`；
- 共用清单全套 + `pnpm verify:motion`。

## 6. 风险与回滚

**风险 1**：`providers.tsx` 若还包裹了其它东西（如 `SmoothScroll`），
移除 Provider 时不要连带删掉。改动前完整读一遍该文件。

**风险 2**：删 Provider 后营销页 reduced-motion 若实际失效（即 `MotionConfig`
未覆盖到某些营销组件），需要恢复一层。此时**不要恢复 `marketing-motion.tsx`**——
在 `(marketing)/layout.tsx` 补一个 `MotionConfig` 即可，仍保持只有一套机制。

**风险 3**：`sidebar.tsx` 删宽度类后，若有第三方消费路径（非 `AnimatedAside`）
直接渲染它并依赖内部宽度，会塌成 0 宽。执行前 grep `<PurpleInkSidebar` / `<AppSidebar`
确认全部消费点。

**回滚**：建议两个提交（marketing-motion 删除 / 侧栏死代码），分别可 revert。

## 7. 完成判据

- [ ] `src/lib/marketing-motion.tsx` 已删除，`pnpm typecheck` 通过；
- [ ] 全仓库只有一个 `fadeInUp` 定义（`src/lib/motion/variants.ts`）；
- [ ] reduced-motion 只有两层，且营销页已浏览器实测有效；
- [ ] `sidebar.tsx` 无宽度过渡与宽度类，demo 已改用 `AnimatedAside`；
- [ ] 基线零差异；
- [ ] `motion-interaction.md` §7.4 已回写；
- [ ] 两个 Conventional Commit。
