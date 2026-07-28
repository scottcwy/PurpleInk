---
kind: frontend_style
name: Tailwind v4 + CSS 变量设计令牌系统
category: frontend_style
scope:
    - '**'
source_files:
    - src/app/globals.css
    - src/app/design-system.css
    - src/app/layout.tsx
    - src/app/providers.tsx
    - src/lib/theme-mode.ts
    - postcss.config.mjs
    - next.config.ts
    - package.json
---

本项目采用 Tailwind CSS v4（通过 `@tailwindcss/postcss`）作为样式框架，结合原生 CSS 自定义属性构建完整的设计令牌体系，实现浅色/深色双主题与一致的视觉规范。

**样式系统与工具链**
- 使用 Tailwind CSS v4 的 `@import "tailwindcss"` 语法，通过 `postcss.config.mjs` 启用 `@tailwindcss/postcss` 插件。
- 根布局 `src/app/layout.tsx` 引入 `globals.css`，并通过 `next-themes` 的 `ThemeProvider`（`attribute="class"`、`defaultTheme="system"`、`storageKey="theme-mode"`）管理主题切换。
- 字体通过 Next.js `next/font/google` 加载 Geist Sans/Mono，注入为 CSS 变量 `--font-geist-sans` / `--font-geist-mono`。

**设计令牌架构**
- `src/app/globals.css` 定义核心基础令牌：背景、前景、边框、环、强调色、圆角、阴影、动画时长与缓动函数，并通过 `@theme inline` 映射到 Tailwind 的 `--color-*`、`--radius-*`、`--ease-*` 等命名空间。
- `src/app/design-system.css` 定义应用级设计令牌（`--ds-*` 前缀），包括渐变、表面、文本、主色、画布背景、按钮渐变与阴影，并暴露 `ds-app-gradient`、`ds-dot-grid`、`ds-primary-button` 等语义化类。
- 两套令牌均提供 `.dark` 变体，通过 `document.documentElement.classList.toggle('dark', ...)` 切换。
- CodeVideoCanvas 专属令牌（`--color-stage-*`、`--color-canvas-*`、`--color-label-*` 等）在 `globals.css` 中集中定义，覆盖阶段颜色、画布网格、玻璃态、提示框等复杂场景。

**主题模式与运行时**
- `src/lib/theme-mode.ts` 提供类型安全的主题模式管理：`light | dark | system` 三种模式，支持循环切换与系统偏好检测。
- 根布局内嵌脚本在 SSR 阶段即根据 `localStorage` 或系统偏好设置 `dark` 类，避免闪烁。
- `next.config.ts` 配置 `viewport.themeColor` 随主题变化，`compiler.removeConsole` 在生产环境保留 `error`/`warn` 用于诊断。

**组件库与样式约定**
- `src/components/ui/` 下每个 UI 组件独立文件（button、dialog、sidebar、toast 等），配合 `clsx` 和 `tailwind-merge` 进行条件样式合并。
- 全局无障碍样式：`focus-ring`、`skip-to-content`、`scrollbar-hide`、`line-clamp-*` 等实用类统一提供。
- 滚动条、选中高亮、减少动画偏好（`prefers-reduced-motion`）均在 `globals.css` 中统一处理。

**约束与规范**
- 所有颜色、圆角、阴影、动画参数必须通过 CSS 变量引用，禁止硬编码字面量。
- 主题切换仅通过 `dark` 类名控制，不依赖 JS 动态计算样式。
- 组件样式遵循原子化 CSS 原则，组合类名而非嵌套选择器。