---
kind: frontend_style
name: Tailwind v4 + CSS 变量设计令牌体系
category: frontend_style
scope:
    - '**'
source_files:
    - src/app/globals.css
    - src/app/design-system.css
    - src/app/providers.tsx
    - src/lib/theme-mode.ts
    - postcss.config.mjs
    - package.json
---

本项目采用 **Next.js App Router + Tailwind CSS v4** 作为前端样式体系，通过 CSS 自定义属性（CSS Variables）构建完整的设计令牌系统，并配合 `next-themes` 实现亮/暗/跟随系统的主题切换。

### 样式系统与工具链
- **Tailwind CSS v4**：通过 `@tailwindcss/postcss` 插件在 PostCSS 中启用，无传统 `tailwind.config.ts`，配置内联于 CSS 的 `@theme inline` 块。
- **PostCSS 仅加载 Tailwind**：`postcss.config.mjs` 仅注册 `@tailwindcss/postcss`，保持极简。
- **Prettier 集成**：`prettier-plugin-tailwindcss` 自动排序 class 顺序。
- **主题管理**：`next-themes` 以 `class="dark"` 模式驱动，存储键为 `theme-mode`，默认跟随系统。

### 设计令牌架构
令牌分为三层，全部通过 CSS 变量定义并在 `@theme inline` 中映射到 Tailwind 原子类：
1. **基础层**（`globals.css`）：背景、前景、边框、环、字体等通用变量，如 `--background`、`--foreground`、`--ring`、`--font-sans`。
2. **应用层**（`design-system.css`）：产品级设计系统变量，前缀 `--ds-*`，包含渐变、表面、文本、主色、画布、遮罩等，如 `--ds-surface`、`--ds-primary`、`--ds-canvas`。
3. **领域层**（`globals.css` CodeVideoCanvas 令牌）：面向视频工作流的语义化颜色，如 `--color-stage-ingest`、`--color-stage-direct`、`--color-accent`、`--color-success`、`--color-warning`、`--color-danger`，以及阴影、圆角、动画时长、缓动函数等。

所有令牌均提供 `.dark` 变体，通过 `html.dark` 类名切换。

### 主题与响应式策略
- **主题切换**：`src/lib/theme-mode.ts` 提供 `light | dark | system` 三种模式及切换逻辑，`applyTheme()` 直接操作 `document.documentElement.classList`。
- **全局 Provider**：`src/app/providers.tsx` 使用 `<ThemeProvider attribute="class" defaultTheme="system">` 包裹整个应用。
- **无障碍**：内置 `prefers-reduced-motion` 媒体查询禁用动画；统一 `focus-visible` 环样式；提供 `skip-to-content` 跳转链接。
- **滚动条定制**：全局覆盖 `scrollbar-width`、`scrollbar-color` 及 WebKit 滚动条样式。

### 组件库组织
UI 组件集中在 `src/components/ui/`，每个组件配套 `.demo.tsx` 和可选的 `.test.ts`，遵循单一职责。常用组合包括 `button`、`dialog`、`popover`、`sidebar`、`settings-*`、`pipeline-node`、`media-viewport` 等。营销页面组件位于 `src/components/marketing/`，图标使用 `lucide-react`。

### 关键约束与约定
- 所有视觉常量必须通过 CSS 变量暴露，禁止在组件中硬编码颜色值。
- 主题相关样式必须同时提供 `.dark` 变体。
- Tailwind 类名由 Prettier 插件自动排序，无需手动维护顺序。
- 动画与过渡统一使用 `--duration-*` 和 `--ease-*` 变量，确保节奏一致。