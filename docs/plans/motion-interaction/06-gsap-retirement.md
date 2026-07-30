# 06 · GSAP 下线与 Lenis 作用域收窄

- 前置：05 完成（同批营销页验证）
- 消掉意图：无
- 共用硬边界与验证清单见 `00-README.md` §0
- 决策依据：`00-README.md` D3、D4

## 1. 目标与非目标

**目标**：删掉 `gsap` 依赖，把 Lenis 限定在 `(marketing)` 段，解决它与全局
`scroll-behavior: smooth` 的重复。

**非目标**：不删 Lenis（D4）；不改营销页的滚动叙事设计，只换实现与收窄作用域。

**本批次是整个计划里视觉风险最高的一批（09 之外）。** 动的是滚动行为，
而滚动行为的问题往往只在真实滑动中暴露，静止截图抓不到。

## 2. 现状与判定依据

### 2.1 GSAP

`gsap: ^3.15.0` 在 `package.json`，全仓库**唯一消费者**是
`src/components/marketing/image-reveal.tsx`（用 `gsap` + `ScrollTrigger`）。

判定删除的三条理由：

1. motion 的 `useScroll` 已在同目录做同类事——`text-reveal.tsx`、`stats.tsx`
   （`useInView`）、`hero.tsx`（`useScroll` + `useTransform` + `useSpring`）都是这个模式，
   有现成参照；
2. 为一个组件养第二个动画引擎不划算（规范 §5.4：动画引擎唯一为 `motion`）；
3. GSAP 自带独立的 reduced-motion 处理，是 05 刚清理掉的"第三套机制"问题的另一个实例。

执行前重新确认唯一性：

```powershell
Select-String -Path src/**/*.ts,src/**/*.tsx -Pattern "from ['\"]gsap"
Select-String -Path src/**/*.ts,src/**/*.tsx -Pattern 'ScrollTrigger'
```

⚠️ 注意 `src/lib/gsap/` 目录存在（`index.ts`、`seek-bridge.ts`）。
**先判断它属于哪一侧**：如果它服务于视频渲染 / HyperFrames 的 seek 桥接，
那是渲染侧资产，受确定性红线约束，**不在本计划范围**（`00-README.md` §3），
此时 `gsap` 依赖不能删，只能把 `image-reveal.tsx` 改写并在规范里记录
"GSAP 仅限渲染侧"的例外。**这一条必须在动手前查清，它决定本批次的形态。**

**执行结论（2026-07-31）**：`src/lib/gsap/seek-bridge.ts` 是渲染侧
HyperFrames 确定性 seek 合同，只负责生成暂停 timeline 的脚本文本，本身不 import
npm `gsap`；`server/` 的渲染模板同样使用固定 CDN 版本，不依赖根 workspace 的 npm
包。根依赖的唯一运行时消费者确为营销页 `image-reveal.tsx`，因此保留渲染侧合同并
移除 npm `gsap` 是安全的。

### 2.2 Lenis

`lenis: ^1.3.3`，唯一消费者 `src/components/marketing/smooth-scroll.tsx`，
经 `src/components/marketing/providers.tsx` 挂载——**现状已经只在营销段生效**。

真正的问题是重复与干扰：

- `globals.css` 有全局 `html { scroll-behavior: smooth }`，与 Lenis 的接管重叠；
- Lenis 劫持滚动会干扰 `section-nav.tsx` 的 `animate()` 滚动定位
  （该组件用在设置页的 TOC，属应用壳）；
- 未来 09 的覆盖层 scroll lock 若遇到 Lenis 接管的滚动容器，行为不可预期。

## 3. 精确范围

| 文件 | 动作 |
| --- | --- |
| `src/components/marketing/image-reveal.tsx` | 用 motion 的 `useScroll` + `useTransform` 重写，移除 gsap / ScrollTrigger |
| `package.json` | 移除 `gsap`（**仅当 §2.1 确认 `src/lib/gsap/` 不需要它**） |
| `pnpm-lock.yaml` | 由 `pnpm remove gsap` 生成，**禁止手改** |
| `src/app/globals.css` | 全局 `html { scroll-behavior: smooth }` 限定作用域，见 §3.1 |
| `docs/conventions/motion-interaction.md` | §5.4 记录结论；§7.4 状态列 |

### 3.1 `scroll-behavior` 怎么收窄

两个选项，执行时按实测选：

- **A**：只保留在营销段（用 `(marketing)/layout.tsx` 的根元素类名或
  `:where([data-scroll-smooth])` 限定），应用壳内不启用；
- **B**：整条删除，滚动平滑完全交给 Lenis（营销）与 `animate()`（应用壳 TOC）。

倾向 **B**：应用壳里 `section-nav` 已经用 motion 的 `animate()` 做定位滚动，
全局 `scroll-behavior: smooth` 与它叠加时行为不确定（原生平滑 + JS 补间同时作用）。
但必须先实测：删掉后设置页 TOC 点击定位是否仍平滑。若变成瞬跳，说明 `animate()`
路径没覆盖全部入口，改回 A。

**执行结论（2026-07-31）**：采用 **B**。删除全局规则与根节点上已无消费者的
`data-scroll-behavior="smooth"` 后，营销页仍由 Lenis 产生连续滚动样本；设置页
`SectionNav` 在不挂载 Lenis 的前提下由 Motion `animate()` 连续更新嵌套容器
`scrollTop`，完成后 `[data-glow]` 正常进入 `glow-active`。两侧计算得到的原生
`scroll-behavior` 均为 `auto`，不存在原生平滑与 JS 补间叠加。

## 4. 执行步骤

1. **先查清 `src/lib/gsap/` 的归属**（§2.1 的 ⚠️）。这决定 `gsap` 能不能删。
   若不能删，本批次范围缩小为「`image-reveal` 改写 + 规范记录例外 + Lenis 收窄」，
   并在本文档回写结论。
2. 读 `hero.tsx` 与 `text-reveal.tsx` 的 `useScroll` 用法作为参照，
   重写 `image-reveal.tsx`。保持**视觉效果等价**为目标，不趁机改设计。
3. 若可删：`pnpm remove gsap`，确认 `pnpm-lock.yaml` 由命令生成。
4. 处理 `scroll-behavior`（§3.1），按实测在 A / B 之间定。
5. 在 `motion-interaction.md` §5.4 写明：动画引擎唯一为 motion（或记录渲染侧例外）；
   Lenis 仅 `(marketing)`，应用壳禁用。
6. 回写 §7.4 状态列两行（GSAP、Lenis）。

## 5. 验证

本批次的验证必须以**动态**为主，静止截图不够：

- **营销首页整页滚动录屏**，从顶到底再回顶。重点看 `image-reveal` 的揭示时机与
  原实现是否等价，以及它与 Lenis 平滑滚动、`hero` 视差是否叠加异常；
- **设置页 TOC 点击定位**（`section-nav`）：确认 `scroll-behavior` 改动后仍平滑，
  且高亮块的 `[data-glow]` 发光时机正常；
- `reduced-motion` 下：营销页滚动不应有额外补间，`image-reveal` 应直接呈现终态。
  GSAP 移除后这条由 `MotionConfig` 统一负责，**必须实测**；
- 基线比对（营销首页静止态应零差异或仅有可解释差异）；
- `pnpm build` 后确认产物不含 gsap chunk（若已删依赖）；
- 共用清单全套 + `pnpm verify:motion`。

## 6. 风险与回滚

**风险 1（最高）**：`ScrollTrigger` 的触发语义与 motion 的 `useScroll` 不完全等价。
GSAP 的 ScrollTrigger 基于滚动位置区间与 scrub，motion 的 `useScroll` 返回进度值
需要自己映射。**重写后揭示时机可能偏移**。这是本批次唯一"必须靠眼睛"的部分，
录屏对比是唯一可靠手段。若无法做到视觉等价，**允许保留 GSAP 并在规范记录例外**——
`00-README.md` D3 是"真删"的意向，不是"不惜代价删"。

**风险 2**：Lenis 与 `scroll-behavior` 都动，若出问题难以定位是哪一个。
**因此拆成两个提交**：先 `image-reveal` 改写 + 删依赖，再 Lenis / `scroll-behavior` 收窄。

**风险 3**：删依赖会动 `pnpm-lock.yaml`，与并行工作的 lock 改动可能冲突。
执行前 `git status --porcelain` 确认 lock 干净。

**回滚**：两个提交分别 revert。删依赖那个 revert 后需要 `pnpm install` 恢复。

## 7. 完成判据

- [x] `src/lib/gsap/` 的归属已查清并记录在本文档；
- [x] `image-reveal.tsx` 已改用 motion，营销页滚动录屏确认视觉等价（原始 GSAP：
  `output/playwright/motion-06-image-reveal-before.webm`；Motion：
  `output/playwright/motion-06-image-reveal-after.webm`）；
- [x] `gsap` 已从 `package.json` 移除（渲染侧固定 CDN / seek 合同不依赖该包）；
- [x] `scroll-behavior` 已删除，设置页 TOC 定位实测平滑且 glow 正常；
- [x] 营销页 `reduced-motion` 实测有效，图片首帧与稳定态均为终态且无 hydration
  mismatch；
- [x] `motion-interaction.md` §5.4 与 §7.4 已回写；
- [x] 两个 Conventional Commit。
