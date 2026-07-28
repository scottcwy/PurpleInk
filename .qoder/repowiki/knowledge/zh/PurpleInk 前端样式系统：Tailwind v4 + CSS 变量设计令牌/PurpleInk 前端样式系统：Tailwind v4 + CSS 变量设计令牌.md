---
kind: frontend_style
name: PurpleInk 前端样式系统：Tailwind v4 + CSS 变量设计令牌
category: frontend_style
scope:
    - '**'
source_files:
    - src/app/globals.css
    - src/app/design-system.css
    - src/lib/theme-mode.ts
    - src/app/providers.tsx
    - src/lib/utils.ts
    - src/components/ui/button.tsx
    - postcss.config.mjs
    - next.config.ts
    - package.json
---

## 1. 使用的系统与工具
- **CSS 框架**：Tailwind CSS v4（通过 `@tailwindcss/postcss` 插件集成，无传统 `tailwind.config.js`）
- **样式预处理**：PostCSS 仅配置 Tailwind 插件，无 Sass/Less
- **主题切换**：`next-themes` + CSS `:root` / `.dark` 双套变量
- **类名合并**：`clsx` + `tailwind-merge` 的 `cn()` 工具函数作为唯一入口
- **图标库**：`lucide-react`
- **动画库**：`motion`（Framer Motion）、`gsap`、`lenis`（滚动）
- **构建器**：Next.js 16 + Turbopack

## 2. 核心文件与包
- `src/app/globals.css` — 全局 CSS 变量、暗色主题、Tailwind `@theme inline` 映射、基础重置、滚动条样式、无障碍焦点环
- `src/app/design-system.css` — 设计系统令牌（ds-* 前缀），含渐变、表面、边框、按钮等语义化颜色与实用类
- `src/lib/theme-mode.ts` — 主题模式枚举、解析与切换逻辑（light/dark/system）
- `src/app/providers.tsx` — `next-themes` 根 Provider 配置
- `src/lib/utils.ts` — `cn()` 类名合并工具（SSOT）
- `src/components/ui/button.tsx` — 设计系统按钮组件示例（四种变体、三种尺寸）
- `postcss.config.mjs` — PostCSS 配置（仅 Tailwind）
- `next.config.ts` — Next 构建配置（Turbopack root、外部包、重写规则）
- `package.json` — 依赖声明（Tailwind v4、clsx、tailwind-merge、next-themes、lucide-react、motion）

## 3. 架构与设计约定
- **双层 CSS 变量体系**：
  - 第一层（`globals.css`）：通用 UI 令牌（background/foreground/muted/border/ring/accent 等）+ CodeVideoCanvas 专用令牌（color-stage-*、color-canvas-*、shadow-*、radius-*、ease-*、duration-*）
  - 第二层（`design-system.css`）：应用级 ds-* 令牌（ds-surface、ds-primary、ds-blue、ds-button-bg 等），通过 `@theme inline` 暴露为 Tailwind 自定义颜色
- **暗色主题策略**：所有令牌均在 `:root` 和 `.dark` 中成对定义，通过 `document.documentElement.classList.toggle('dark', ...)` 切换
- **Tailwind v4 零配置风格**：不使用 `tailwind.config.js`，直接在 CSS 中用 `@theme inline` 注册自定义颜色、字体、阴影、圆角、缓动曲线与动画
- **组件样式约定**：所有 UI 组件位于 `src/components/ui/`，使用 `cn()` 合并类名，通过 `variant`/`size` 属性控制外观，避免内联样式
- **响应式与可访问性**：`prefers-reduced-motion` 媒体查询禁用动画；统一的 `focus-visible` 焦点环样式；`.skip-to-content` 跳过链接
- **滚动条统一**：全局覆盖 `scrollbar-width`、`scrollbar-color` 及 WebKit 滚动条样式，提供 `.scrollbar-hide` 工具类

## 4. 约定与约束
- **类名合并必须通过 `cn()`**：`src/lib/utils.ts` 是唯一导出点，确保 Tailwind 冲突被正确解决
- **设计令牌命名规范**：通用令牌无前缀，Canvas 专用令牌以 `--color-*` 开头，设计系统令牌以 `--ds-*` 开头并映射到 `--color-ds-*` 供 Tailwind 使用
- **按钮组件 SSOT**：`buttonClassName()` 函数集中管理所有按钮外观配方，禁止在组件外复制样式字符串
- **主题模式顺序固定**：`THEME_MODE_ORDER = ['light', 'dark', 'system']`，切换按此循环
- **动画性能约束**：`prefers-reduced-motion` 强制将动画时长降至 0.01ms；`.no-focus-ring` 显式移除焦点环（需慎用）
- **Tailwind v4 语法**：使用 `@import "tailwindcss"` 而非 `@tailwind base/components/utilities`；自定义动画通过 `@theme inline` 中的 `--animate-*` 变量注册