---
kind: frontend_style
name: Tailwind CSS v4 + CSS 变量设计令牌体系
category: frontend_style
scope:
    - '**'
source_files:
    - src/app/globals.css
    - src/app/design-system.css
    - src/app/providers.tsx
    - src/lib/theme-mode.ts
    - postcss.config.mjs
    - next.config.ts
    - package.json
---

PurpleInk 前端样式体系基于 Tailwind CSS v4（@tailwindcss/postcss）与原生 CSS 自定义属性（CSS Variables）构建，采用「全局设计令牌 → Tailwind 主题映射 → 组件原子类」的分层架构。

**样式系统与工具链**
- 使用 `postcss.config.mjs` 仅配置 `@tailwindcss/postcss` 插件，无传统 `tailwind.config.js`，通过 `globals.css` 中的 `@theme inline` 直接声明主题变量。
- Next.js 16 + Turbopack 作为构建器，生产环境移除 console.log（保留 error/warn），禁用 source maps。
- 依赖 `next-themes` 提供 theme provider，通过 `attribute="class"` 在 `<html>` 上切换 `dark` 类实现明暗主题。

**设计令牌分层**
- `src/app/globals.css`：定义应用级 CSS 变量（--background、--foreground、--accent 等）及 CodeVideoCanvas 专用令牌（--color-stage-*、--color-canvas-bg、--shadow-card 等），并通过 `@theme inline` 映射到 Tailwind 的 `--color-*` 命名空间。
- `src/app/design-system.css`：定义独立的设计系统令牌（--ds-surface、--ds-primary、--ds-button-start/end 等），提供渐变、点阵背景、按钮阴影等复用样式类（`.ds-app-gradient`、`.ds-dot-grid`、`.ds-primary-button`）。
- 双主题支持：`:root` 与 `.dark` 分别定义浅色/深色令牌，通过 `next-themes` 的 `defaultTheme="system"` 自动跟随系统偏好。

**组件样式约定**
- 基础 UI 组件位于 `src/components/ui/`，每个组件配套 `.demo.tsx` 文件用于可视化测试，部分组件包含 `.test.ts` 验证渲染行为。
- 组件样式以 Tailwind 原子类为主，结合 CSS 变量实现主题化；使用 `clsx` 和 `tailwind-merge` 处理条件类名合并。
- 图标统一使用 `lucide-react`，品牌图标位于 `src/components/icons/`。

**可访问性与动效**
- 全局 `focus-visible` 样式提供一致的焦点环（2px solid var(--ring)），支持 `.no-focus-ring` 覆盖。
- `@media (prefers-reduced-motion: reduce)` 强制禁用动画以满足无障碍需求。
- 滚动条统一通过 CSS 变量定制（--scrollbar-size、--scrollbar-thumb 等），并提供 `.scrollbar-hide` 工具类。
- 文本截断使用 `.line-clamp-2/.line-clamp-3` 工具类，加载态使用 `shimmer` 动画。

**响应式策略**
- 基于 Tailwind CSS v4 的响应式断点系统，无自定义媒体查询，通过 `sm:`、`md:`、`lg:` 等前缀控制布局。
- 画布区域使用固定宽高比与网格背景（--color-canvas-grid），确保多设备一致性。

**代码组织约束**
- 所有样式必须通过 CSS 变量或 Tailwind 原子类实现，禁止在组件内联 style 中硬编码颜色值。
- 主题切换逻辑集中在 `src/lib/theme-mode.ts`，提供 `applyTheme`、`resolveDarkMode` 等工具函数。