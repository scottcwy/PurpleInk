---
kind: frontend_style
name: Tailwind v4 + CSS 变量设计系统（双主题 Token 体系）
category: frontend_style
scope:
    - '**'
source_files:
    - src/app/globals.css
    - src/app/design-system.css
    - src/lib/motion/tokens.ts
    - src/lib/theme-mode.ts
    - src/app/providers.tsx
    - postcss.config.mjs
    - src/components/ui/button.tsx
    - package.json
---

## 1. 系统与工具链
- 样式框架：Tailwind CSS v4（通过 `@tailwindcss/postcss` 插件集成），采用 `@import "tailwindcss" source(none)` 配合 `@source "../**/*.{ts,tsx}"` 精确限定扫描范围，避免 docs 中的类名污染构建产物。
- 主题切换：基于 `next-themes` 的 `ThemeProvider`，以 `class="dark"` 模式驱动 CSS 变量切换，默认跟随系统，持久化键为 `theme-mode`。
- 动画库：`motion`（原 framer-motion）用于交互动效，与 CSS 动效 token 一一对应。
- 构建配置：PostCSS 仅启用 `@tailwindcss/postcss`；Next.js 生产环境移除 console.log（保留 error/warn），Turbopack root 固定到当前目录。

## 2. 核心文件与包
- `src/app/globals.css`：全局 CSS 入口，定义 light/dark 两套 CSS 变量、Tailwind `@theme inline` 映射、滚动条/焦点环/行裁剪等基础样式。
- `src/app/design-system.css`：应用级设计系统 token（`--ds-*` 前缀），包含渐变、表面、边框、文本、主色、画布、遮罩、按钮等，并通过 `@theme inline` 暴露为 Tailwind 颜色。
- `src/lib/motion/tokens.ts`：动效 token 的 JS 镜像（DURATION/EASE/TRANSITION_* / SPRING_*），与 CSS 变量严格同步，由测试校验一致性。
- `src/lib/theme-mode.ts`：主题模式类型与工具函数（light/dark/system 循环切换、解析 dark 模式、标签文案）。
- `src/app/providers.tsx`：根 Provider，注入 `next-themes` 与 ToastViewport。
- `postcss.config.mjs`：仅注册 Tailwind v4 PostCSS 插件。
- `package.json`：依赖 tailwindcss ^4、@tailwindcss/postcss ^4、motion、next-themes、tailwind-merge、clsx。

## 3. 架构与设计约定
- **Token 分层**：
  - 全局语义变量（`--background`、`--foreground`、`--accent`、`--radius-*`、`--duration-*`、`--ease-*`）定义在 `:root` 与 `.dark` 中。
  - CodeVideoCanvas 专用变量（`--color-accent`、`--color-stage-*`、`--color-canvas-bg`、`--shadow-card` 等）集中声明，再通过 `@theme inline` 映射到 Tailwind 命名空间。
  - 设计系统变量（`--ds-*` 前缀）独立于全局变量，提供 ds-surface、ds-primary、ds-blue、ds-button-bg 等应用级语义。
- **Tailwind v4 映射策略**：所有 CSS 变量通过 `@theme inline { --color-*: var(--*) }` 暴露给 Tailwind，组件中使用 `bg-ds-surface`、`text-ds-text`、`focus-visible:ring-ds-ring` 等类名。
- **动效 Token 三处同步**：新增时长档位必须同时修改 `globals.css` 的 `:root`、`@theme inline` 的 `--transition-duration-*`、以及 `src/lib/motion/tokens.ts`，并由 `tokens.test.ts` 强制校验一致性。
- **暗色模式**：通过 `html.dark` 切换 `color-scheme`，`.dark` 选择器覆盖所有 CSS 变量，实现完整的明暗主题。
- **可访问性**：统一 `focus-visible` 环样式（`--ring`）、`skip-to-content` 跳转链接、`prefers-reduced-motion` 媒体查询禁用动画。
- **组件样式组织**：UI 组件位于 `src/components/ui/`，每个组件配套 `.demo.tsx` 与可选 `.test.ts`；按钮等复合组件通过 `buttonClassName()` 工厂函数统一变体/尺寸配方，使用 `cn()`（来自 `@/lib/utils`，即 `clsx + tailwind-merge`）合并类名。

## 4. 约定与约束
- **扫描范围限制**：`globals.css` 显式使用 `source(none)` 并仅 `@source "../**/*.{ts,tsx}"`，禁止 Tailwind 扫描 docs 或 public 目录，防止文档中的类名字面量污染样式表。
- **动效规范**：时长档位（fast/base/slow/narrative）与缓动曲线（standard/emphasized/exit）是权威源，所有 UI 过渡必须引用这些 token，禁止硬编码数值。
- **营销段隔离**：`--duration-narrative` 与 `TRANSITION_NARRATIVE` 仅限 `(marketing)` 路由段使用，见 motion-interaction.md §5.4。
- **弹簧动画约束**：仅允许用于位移/尺寸/布局（spatial），颜色与透明度禁止 spring；小控件 bounce 上限 0.25，大面积转场 bounce 降至 0.12。
- **退出动画禁令**：抽屉滑出等退出场景禁止使用 spring，必须用 `TRANSITION_EXIT`（fast + exit ease）。
- **主题切换**：通过 `next-themes` 的 `attribute="class"` 模式，在 `html` 元素上切换 `dark` 类，禁止直接操作 `document.documentElement.style`。
- **设计系统按钮变体**：`primary`（扁平墨色实心，零投影）、`tinted`（蓝底蓝字）、`gray`（边框+表面）、`destructive`（红色）四种变体，通过 `ds-primary-button` 等 CSS 类复用。
- **滚动条定制**：全局 `scrollbar-width: thin` + Webkit 伪元素覆盖，提供 `scrollbar-hide` 工具类隐藏滚动条。
- **行裁剪工具**：`.line-clamp-2`、`.line-clamp-3` 作为全局工具类，避免重复编写 `-webkit-line-clamp`。