---
kind: frontend_style
name: 前端样式体系：Tailwind CSS v4 + CSS 变量设计令牌
category: frontend_style
scope:
    - '**'
source_files:
    - src/app/globals.css
    - src/app/design-system.css
    - src/app/layout.tsx
    - src/app/providers.tsx
    - postcss.config.mjs
    - package.json
    - src/lib/theme-mode.ts
---

本项目采用 Tailwind CSS v4（通过 `@tailwindcss/postcss`）作为核心样式框架，结合 CSS 自定义属性（CSS Variables）构建完整的设计令牌系统，实现浅色/深色双主题与一致的视觉规范。

**样式架构与工具链**
- 样式入口为 `src/app/globals.css`，通过 `@import "tailwindcss"` 引入 Tailwind v4，并级联导入 `design-system.css`。
- PostCSS 配置仅启用 `@tailwindcss/postcss` 插件，无额外预处理层。
- 字体通过 Next.js `next/font/google` 注入 Geist Sans/Mono，并以 CSS 变量 `--font-sans`、`--font-mono` 暴露给 Tailwind。
- 主题切换由 `next-themes` 的 `ThemeProvider` 在 `src/app/providers.tsx` 中提供，默认跟随系统，存储键为 `theme-mode`。

**设计令牌体系**
- `globals.css` 定义了两套完整的 CSS 变量：基础语义变量（`--background`、`--foreground`、`--accent` 等）与 CodeVideoCanvas 专用变量（`--color-accent`、`--color-stage-*`、`--color-canvas-bg`、`--shadow-*`、`--radius-*`、`--ease-*` 等），分别对应 light/dark 两套配色。
- `design-system.css` 定义 ds-* 前缀的设计系统令牌（`--ds-surface`、`--ds-primary`、`--ds-blue` 等），并通过 `@theme inline` 映射到 Tailwind 的 `--color-ds-*` 命名空间。
- 所有令牌通过 `@theme inline` 暴露给 Tailwind，组件直接使用 `bg-background`、`text-foreground`、`border-border`、`rounded-md` 等原子类。

**主题与响应式策略**
- 通过 `.dark` 类切换暗色模式，根节点 `<html>` 设置 `data-scroll-behavior="smooth"`，body 使用 `bg-background text-foreground font-sans antialiased`。
- 支持 `prefers-reduced-motion` 媒体查询，自动禁用动画以满足无障碍需求。
- 全局滚动条样式通过 `::-webkit-scrollbar` 伪元素统一定制，并提供 `.scrollbar-hide` 工具类。
- 焦点可见性通过 `.focus-ring` 和 `:focus-visible` 选择器统一处理，确保键盘导航可访问性。

**组件库组织**
- UI 组件位于 `src/components/ui/`，每个组件配套 `.demo.tsx` 演示文件与可选的 `.test.ts` 测试文件，如 `button.tsx`、`dialog.tsx`、`sidebar.tsx`、`pipeline-node.tsx` 等。
- 营销页面组件位于 `src/components/marketing/`，包含 `header`、`hero`、`footer`、`pricing` 等独立页面组件。
- 图标统一使用 `lucide-react`，并在 `src/components/icons/` 中封装 Logo 与自定义图标。

**约束与约定**
- 颜色、圆角、阴影、动效缓动等全部通过 CSS 变量集中管理，禁止在组件中硬编码具体数值。
- 主题切换必须通过 `next-themes` 提供的 `ThemeProvider`，不得直接操作 DOM class。
- 所有交互元素需提供 `:focus-visible` 样式，遵循统一的 ring 风格（`--ring: #6366f1`）。
- 动画需尊重 `prefers-reduced-motion`，避免强制重绘。