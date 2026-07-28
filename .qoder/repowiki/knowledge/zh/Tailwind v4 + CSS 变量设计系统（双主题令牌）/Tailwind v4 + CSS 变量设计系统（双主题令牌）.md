---
kind: frontend_style
name: Tailwind v4 + CSS 变量设计系统（双主题令牌）
category: frontend_style
scope:
    - '**'
source_files:
    - src/app/globals.css
    - src/app/design-system.css
    - src/lib/theme-mode.ts
    - src/components/ui/button.tsx
    - postcss.config.mjs
    - package.json
---

## 1. 系统与工具链
- 样式框架：Tailwind CSS v4（通过 `@tailwindcss/postcss` 插件集成，无 `tailwind.config.js`，采用 CSS-first 配置）。
- PostCSS 仅注册 `@tailwindcss/postcss`，由 Tailwind 自身处理构建管线。
- Next.js App Router 中通过 `src/app/globals.css` 全局引入 Tailwind 与自定义设计系统。
- 字体使用 `next/font/google` 注入 Geist Sans / Mono 为 CSS 变量 `--font-geist-sans` / `--font-geist-mono`。
- 动画库：GSAP（`gsap`）、Framer Motion（`motion`），配合 `lenis` 平滑滚动。
- 主题切换依赖 `next-themes`，并通过内联脚本在 HTML 渲染前同步 `dark` 类，避免闪烁。

## 2. 核心文件与包
- `src/app/globals.css`：Tailwind 入口、全局 CSS 变量（light/dark 两套）、`@theme inline` 映射到 Tailwind 语义色/圆角/阴影/动效。
- `src/app/design-system.css`：应用级设计令牌（`--ds-*` 系列），包含渐变、表面、边框、文本、主色、按钮阴影等，并暴露 `ds-app-gradient`、`ds-dot-grid`、`ds-primary-button` 等组合类。
- `src/lib/theme-mode.ts`：主题模式枚举与切换逻辑（light/dark/system），提供 `applyTheme` / `resolveDarkMode` 等纯函数。
- `src/components/ui/button.tsx`：UI 原子组件示例，集中定义 4 种变体（primary/tinted/gray/destructive）与 3 种尺寸，统一通过 `cn()` 合并 className。
- `postcss.config.mjs`：仅启用 `@tailwindcss/postcss`。
- `package.json`：声明 `tailwindcss@^4`、`@tailwindcss/postcss@^4`、`tailwind-merge`、`clsx`、`next-themes` 等前端样式相关依赖。

## 3. 架构与设计约定
- **CSS 变量驱动的双主题**：所有颜色、圆角、阴影、动效缓动均以 `--color-*`、`--radius-*`、`--shadow-*`、`--ease-*` 等 CSS 变量定义，`.root` 与 `.dark` 分别覆盖，组件只消费变量名，不直接写死色值。
- **Tailwind `@theme inline` 映射层**：将 CSS 变量映射为 Tailwind 可用的 `--color-*`、`--font-*`、`--radius-*` 等，使组件可用 `bg-background text-foreground rounded-md` 等语义化类。
- **设计系统分层**：
  - 基础层：`globals.css` 中的通用 token（背景、前景、muted、border、ring、accent、字体）。
  - 应用层：`design-system.css` 的 `--ds-*` 令牌，聚焦产品视觉语言（渐变、surface、canvas、button shadow 等）。
  - 组件层：`src/components/ui/*` 原子组件封装具体样式配方，对外暴露 props（如 Button 的 variant/size）而非硬编码 className。
- **暗色模式策略**：根 `<html>` 通过内联脚本在 hydration 前设置 `dark` 类；`layout.tsx` 的 viewport themeColor 按 `prefers-color-scheme` 区分；`theme-mode.ts` 提供 light/dark/system 三种模式切换。
- **可访问性基线**：全局 `focus-visible` ring、`skip-to-content` 跳转链接、`prefers-reduced-motion` 媒体查询禁用动画、`color-scheme: light/dark` 声明。
- **响应式与布局**：未使用传统 breakpoint 配置，而是依赖 Tailwind 默认断点与 CSS Grid/Flexbox；部分页面使用 `lg:grid lg:grid-cols-2` 等实用类。

## 4. 约定与约束
- **样式来源单一**：所有 UI 样式必须通过 Tailwind 语义类或 `design-system.css` 暴露的组合类（如 `ds-primary-button`、`ds-app-gradient`），禁止在组件内编写独立 CSS 块。
- **颜色与 token 消费规范**：组件应引用 `--color-*` 或 `--ds-*` 变量，不得硬编码十六进制色值；新 token 需同时补充 light/dark 两套定义。
- **组件样式封装**：UI 原子组件（如 Button）以 `buttonClassName()` 工厂函数作为 SSOT，通过 `clsx` + `tailwind-merge` 合并外部 className，确保覆盖可控。
- **主题切换一致性**：主题状态由 `theme-mode.ts` 统一管理，组件不应自行操作 `document.documentElement.classList`。
- **动画与动效**：优先使用 Tailwind 内置 transition/animation 或 `@keyframes shimmer` 等全局动画；复杂动效通过 GSAP/Motion 管理，且需尊重 `prefers-reduced-motion`。
- **滚动条与选择高亮**：全局统一 thin scrollbar 与 accent 色 selection，组件无需重复实现。
- **文档化设计系统**：`docs/designs/Design-system-inventory.md` 记录令牌清单与组件变体，是新增样式的权威参考。