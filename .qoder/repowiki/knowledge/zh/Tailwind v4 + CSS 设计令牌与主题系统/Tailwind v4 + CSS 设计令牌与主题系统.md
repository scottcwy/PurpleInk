---
kind: frontend_style
name: Tailwind v4 + CSS 设计令牌与主题系统
category: frontend_style
scope:
    - '**'
source_files:
    - src/app/globals.css
    - src/app/design-system.css
    - src/app/layout.tsx
    - src/app/providers.tsx
    - src/lib/utils.ts
    - src/lib/theme-mode.ts
    - src/components/ui/button.tsx
    - postcss.config.mjs
    - package.json
---

本项目采用 **Tailwind CSS v4**（通过 `@tailwindcss/postcss`）作为核心样式框架，结合原生 CSS 变量构建完整的设计令牌系统与暗色主题支持。整体风格遵循「扁平墨色实心」的 Vercel/Linear 式设计语言，强调零投影、零渐变的高对比度界面。

### 样式架构
- **全局入口**：`src/app/globals.css` 通过 `@import "tailwindcss"` 引入 Tailwind，并导入 `design-system.css` 扩展设计令牌。
- **设计令牌分层**：
  - `globals.css` 定义基础语义变量（`--background`、`--foreground`、`--accent` 等）与 CodeVideoCanvas 专用颜色（`--color-stage-*`、`--color-canvas-*`），并通过 `@theme inline` 映射到 Tailwind 的 `--color-*` 命名空间。
  - `design-system.css` 定义应用级设计令牌（`--ds-surface`、`--ds-primary`、`--ds-button-bg` 等），同样通过 `@theme inline` 暴露为 `--color-ds-*`。
- **暗色模式**：通过 `.dark` 类切换两套完整的 CSS 变量，由 `next-themes` 的 `ThemeProvider` 管理，默认跟随系统偏好，存储键为 `theme-mode`。

### 组件样式约定
- **className 合并**：所有组件统一通过 `src/lib/utils.ts` 导出的 `cn()` 函数（基于 `clsx` + `tailwind-merge`）合并类名，避免 Tailwind 冲突。
- **UI 组件库**：位于 `src/components/ui/`，每个组件提供 `*.demo.tsx` 演示文件与可选的 `*.test.ts` 测试。按钮组件 `button.tsx` 定义了四种变体（`primary`、`tinted`、`gray`、`destructive`）和三种尺寸，作为全应用统一的视觉原语。
- **设计系统文档**：`src/app/playbook/` 目录包含设计系统清单（`foundations/`、`icons/`、`ui/`），配合 `docs/designs/Design-system-inventory.md` 记录设计规范。

### 动画与交互
- 使用 `motion`（Framer Motion）和 `gsap` 处理复杂动画，`AppMotionConfig` 在根布局中统一配置。
- 尊重 `prefers-reduced-motion`，自动禁用动画。
- 自定义滚动条样式通过 CSS 变量控制，支持隐藏滚动条的工具类（`.scrollbar-hide`）。

### 字体与排版
- 使用 Next.js Font Optimization 加载 Geist Sans/Mono 字体，通过 CSS 变量 `--font-geist-sans`、`--font-geist-mono` 注入。
- 全局设置 `antialiased` 和 `-webkit-font-smoothing: antialiased` 保证字体渲染质量。

### 响应式策略
- 完全依赖 Tailwind 的响应式前缀（`sm:`、`md:`、`lg:` 等），无自定义媒体查询。
- 视口配置在 `layout.tsx` 中声明，支持动态缩放。

### 工具链
- PostCSS 仅配置 `@tailwindcss/postcss` 插件，保持极简。
- Prettier 通过 `prettier-plugin-tailwindcss` 自动排序 Tailwind 类名。
- ESLint 使用 `eslint-config-next` 确保 React/Next.js 最佳实践。