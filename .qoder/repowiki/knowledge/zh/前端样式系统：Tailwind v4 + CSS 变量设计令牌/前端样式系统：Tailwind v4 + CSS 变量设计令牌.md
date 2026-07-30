---
kind: frontend_style
name: 前端样式系统：Tailwind v4 + CSS 变量设计令牌
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
---

本项目基于 Next.js 16 与 Tailwind CSS v4（通过 @tailwindcss/postcss）构建前端样式体系，采用「CSS 自定义属性作为设计令牌 + Tailwind 原子类」的组合方式，配合 next-themes 实现明暗主题切换。

**样式架构与工具链**
- 样式入口为 src/app/globals.css，通过 @import "tailwindcss" 引入 Tailwind v4，并级联 design-system.css 中的设计令牌。
- PostCSS 仅配置 @tailwindcss/postcss 插件，无额外预处理层。
- 字体通过 next/font/google 加载 Geist Sans/Mono，以 CSS 变量 --font-geist-sans / --font-geist-mono 注入。
- 主题切换由 src/app/providers.tsx 中的 ThemeProvider（next-themes）管理，默认跟随系统，存储键为 theme-mode，通过给 <html> 添加/移除 dark class 生效。

**设计令牌体系**
- globals.css 的 :root 与 .dark 块定义了完整的 CSS 变量令牌集，包括：
  - 基础色板：--background、--foreground、--muted、--border、--ring、--accent 等。
  - CodeVideoCanvas 专用色：--color-accent、--color-success、--color-warning、--color-danger、--color-purple、--color-teal 及各 stage 色（--color-stage-ingest、--color-stage-direct 等）。
  - 画布与 UI 令牌：--color-bg、--color-surface、--color-fill、--color-canvas-bg、--color-glass、--color-tooltip-bg、--color-player-bg 等。
  - 阴影与圆角：--shadow-card、--shadow-float、--radius-sm/md/lg/xl/pill。
  - 动效令牌：--duration-fast/base/slow、--ease-standard/emphasized/exit。
  - 滚动条令牌：--scrollbar-size/thumb/thumb-hover/track。
- design-system.css 定义独立的设计系统令牌（--ds-*），用于营销页与通用 UI，如 --ds-surface、--ds-primary、--ds-blue、--ds-button-bg 等，并通过 @theme inline 暴露为 Tailwind 颜色。
- 所有令牌通过 @theme inline 映射到 Tailwind 命名空间，使组件可直接使用 bg-background、text-foreground、rounded-md 等原子类。

**响应式与可访问性约定**
- 全局启用平滑滚动与隐藏横向溢出。
- 通过 prefers-reduced-motion 媒体查询强制禁用动画，满足无障碍需求。
- 统一的 focus ring 样式（focus-ring、no-focus-ring 类）与 ::selection 高亮。
- 提供 skip-to-content 跳过链接与 line-clamp-2/3 文本截断等实用类。
- 滚动条统一为细样式，支持 hover 变色。

**组件样式组织**
- 通用 UI 组件集中在 src/components/ui/，每个组件配套 .demo.tsx 与可选的 .test.ts，样式通过 Tailwind 原子类组合，未使用独立 CSS 文件。
- 营销页组件位于 src/components/marketing/，包含主题切换开关、平滑滚动、流体光标等动效组件。
- 图标使用 lucide-react，Logo 相关组件在 src/components/icons/。

**约束与规范**
- 生产环境通过 next.config.ts 的 compiler.removeConsole 保留 error/warn 日志，其余 console 输出被移除。
- 图片远程域名白名单限制为 picsum.photos 与 images.unsplash.com。
- API 请求统一走 /api/* 路由，由 Next 重写至后端 worker，避免跨域问题。