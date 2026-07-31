# 响应式设计约定

> Created: 2026-07-31 · Status: accepted
> 读者：所有新增页面/控件或调整布局表现的代理。动手改移动端表现前必读。
> 设计稿现状：`canvas.pen` 仅有 1440×900 桌面帧；移动端适配为**代码先行**，本文是其文字真值。

---

## 1. 原则

1. **单一路由树**：全部视口共用同一套路由，不存在 `m.*` 平行路由、独立移动站或 UA 分流。
2. **渐进增强**：默认 Server Component + CSS 响应式；只有结构切换才引入客户端断点判断。
3. **显式降级优于假优化**：窄视口下交互物理不可达的能力，直接显示降级卡说明原因与出路（沿用「未接线/不可用状态必须显式展示」约定），不渲染缩水假界面。

---

## 2. 断点体系

两层断点，各管一类响应：

| 层 | 断点 | 值 | 驱动方式 | 用途 |
| --- | --- | --- | --- | --- |
| JS 结构断点 | `BP_SIDEBAR_HIDDEN` | 900 | `useMediaQuery` | 应用壳 hidden 态、画布降级 |
| JS 结构断点 | `BP_SECONDARY_PANEL_COLLAPSE` | 1180 | `useMediaQuery` | Inspector / 镜头次级面板自动折叠 |
| JS 结构断点 | `BP_SIDEBAR_RAIL` | 1280 | `useMediaQuery` | 应用壳 rail ↔ expanded |
| Tailwind 标准断点 | `sm` / `md` / `lg` / `xl` | 640 / 768 / 1024 / 1280 | CSS 类 | 纯样式响应（列数、字号、显隐） |

- JS 断点唯一定义在 [`src/lib/layout/breakpoints.ts`](../../src/lib/layout/breakpoints.ts)；`max-width` 查询一律写 `BP - 1`。
- **何时用哪层**：切换组件树 / 渲染分支 / 事件挂载的，用 `useMediaQuery` + JS 断点；只改样式（隐藏列、换 grid、缩间距）的，用 Tailwind 类，不为纯样式引入 `'use client'`。
- `useMediaQuery`（`src/lib/hooks/use-media-query.ts`）SSR / 首帧默认 `false`，mount 后同步真实值；消费方需保证首帧默认分支不闪烁（先出骨架或桌面态）。
- **交叉对齐法**：CSS 需要与 JS 断点对齐处，用 Tailwind 任意值变体。实例：`top-bar.tsx` 的 `max-[899px]:pl-10` 与 `BP_SIDEBAR_HIDDEN=900` 对齐（899 = BP − 1）。不得为对齐另造第二份断点常量。
- 纯样式响应示例：营销页 `image-reveal.tsx` 小屏两列，第三列用 `hidden md:flex` 隐藏，动画原点分配保持不变——不改 JS 逻辑、不重算动效。

---

## 3. 应用壳三态

| 视口 | 态 | 表现 |
| --- | --- | --- |
| ≤899px | hidden | 侧栏卸载；悬浮「打开导航」钮 + 左侧抽屉（DrawerOverlay） |
| 900–1279px | rail | 60px 图标栏 |
| ≥1280px | expanded | 248px 完整侧栏，可手动收起为 rail（持久化） |

实现见 [`src/features/navigation/app-sidebar-shell.tsx`](../../src/features/navigation/app-sidebar-shell.tsx)——唯一应用壳，三态逻辑不得在别处复制。hidden 态的悬浮钮占据左上角（<lg 为 40×40，左/上偏移取 `max(0.5rem, safe-area)`，右缘 48px），TopBar 以 `max-[899px]:pl-10` 避让（见 §2）。

---

## 4. 编辑器降级决策

| 页面 | <900px 处理 | 理由 |
| --- | --- | --- |
| 画布 `/products/canvas/[projectId]` | 显式降级卡 | DAG 编辑器数十个拖拽/连线目标在手机上物理不可用，显式降级优于假优化 |
| 镜头 `/products/shots/[shotId]` | 不降级 | 次级面板 <1180px 自动折叠，内容单列可完成审查 |
| 导出 `/products/export/[projectId]` | 不降级 | 面板折叠 + 单列堆叠，小屏仍可验证与下载 |

- 降级卡实现：[`canvas-loader.tsx`](../../src/app/products/(app)/canvas/[projectId]/canvas-loader.tsx) 在 `<BP_SIDEBAR_HIDDEN` 渲染 [`mobile-fallback-card.tsx`](../../src/features/navigation/mobile-fallback-card.tsx)，文本 + 图标双语义，附「返回项目列表」出路。
- 新编辑器类页面按同一标准判断：交互物理不可达 → 显式降级卡；可折叠/单列保留功能 → 不降级。

---

## 5. 触控目标

- 可点元素在移动端热区 **≥40px**（含 padding 扩展后的命中区域，非视觉尺寸）。
- 视觉尺寸不能变时用**负 margin 热区技巧**：`py-N -my-N` 把热区拉高、负 margin 抵消布局占位。实例：`src/app/(auth)/_components/auth-form-shell.tsx` 的 `py-3 -my-3`。
- 桌面紧凑、移动放大的场景用响应式变体（如 `max-lg:min-h-10`），不整体放大桌面控件。
- **优先在设计系统 SSOT 一处解决**，不在调用方逐个补：`components/ui/button.tsx` 的 `SIZES` sm/md 已带 `max-lg:min-h-10`，`components/ui/icon-button.tsx` 已带 `max-lg:size-10`（≥lg 尺寸不变）。新控件沿用同一写法。

---

## 6. safe-area

- `src/app/layout.tsx` viewport 已设 `viewportFit: "cover"`。
- `src/app/globals.css` 提供 `--safe-area-inset-top / right / bottom / left`（`env()` 带 `0px` fallback）。
- 贴屏幕边缘的 fixed 元素（抽屉、悬浮钮、底部工具条）避让刘海/圆角屏时消费这组变量，不在组件里直接写 `env(safe-area-inset-*)`。
- 当前唯一消费方：`app-sidebar-shell.tsx` 的悬浮导航钮 `left-[max(0.5rem,var(--safe-area-inset-left))] top-[max(0.5rem,var(--safe-area-inset-top))]`——用 `max()` 保证非刘海屏仍有 8px 常规边距。
