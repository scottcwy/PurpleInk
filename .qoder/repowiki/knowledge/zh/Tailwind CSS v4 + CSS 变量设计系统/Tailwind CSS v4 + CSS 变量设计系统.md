---
kind: frontend_style
name: Tailwind CSS v4 + CSS 变量设计系统
category: frontend_style
scope:
    - '**'
source_files:
    - src/app/globals.css
    - src/app/design-system.css
    - postcss.config.mjs
    - src/lib/utils.ts
    - src/app/layout.tsx
    - next.config.ts
---

本项目采用 Tailwind CSS v4（通过 @tailwindcss/postcss）作为样式核心，结合 CSS 自定义属性（CSS Variables）构建完整的设计系统与主题体系。

## 样式架构与工具链
- 构建流程：PostCSS 仅配置 @tailwindcss/postcss 插件，无额外预处理层；Tailwind v4 使用新的 @import "tailwindcss" 语法替代传统 tailwind.config.js。
- 字体系统：通过 Next.js next/font/google 注入 Geist Sans/Mono，以 CSS 变量 --font-geist-sans / --font-geist-mono 暴露给 Tailwind 的 --font-sans / --font-mono。
- 类名合并：所有组件统一通过 src/lib/utils.ts 导出的 cn() 函数（基于 clsx + tailwind-merge）合并 className，避免 Tailwind 类冲突。

## 设计令牌（Design Tokens）
全局令牌定义在两个 CSS 文件中，均支持 .dark 模式切换：

1. src/app/globals.css — 应用级基础令牌：
   - 基础色板：--background、--foreground、--muted、--border、--ring、--accent 等
   - CodeVideoCanvas 专用令牌：--color-accent、--color-success、--color-warning、--color-danger、--color-purple、--color-teal 及各阶段颜色（--color-stage-ingest、--color-stage-direct 等）
   - 布局令牌：--radius-*、--shadow-card、--shadow-float、--duration-*、--ease-*、滚动条样式
   - 通过 @theme inline 将 CSS 变量映射到 Tailwind 可识别的 --color-* 命名空间

2. src/app/design-system.css — 设计系统专属令牌：
   - 品牌色系：--ds-primary、--ds-blue、--ds-green、--ds-red、--ds-amber、--ds-magenta
   - 表面与画布：--ds-surface、--ds-surface-muted、--ds-border、--ds-canvas、--ds-scrim
   - 按钮规范：扁平实心风格（注释明确“Vercel/Linear 式零投影”），通过 --ds-button-bg / --ds-button-fg 控制明暗模式反转
   - 提供 .ds-app-gradient、.ds-dot-grid、.ds-primary-button 等可直接复用的样式类

## 主题策略
- 暗色模式：通过 <html class="dark"> 切换，根组件在 layout.tsx 中通过内联脚本在 hydration 前检测 localStorage('theme-mode') 和 prefers-color-scheme 设置初始主题，避免闪烁。
- 颜色方案：html { color-scheme: light/dark } 配合 viewport.themeColor 实现浏览器原生主题适配。
- 无障碍：内置 prefers-reduced-motion 媒体查询禁用动画，全局 focus-visible 样式统一 ring 边框，提供 .skip-to-content 跳过链接。

## 组件库组织
- UI 组件集中在 src/components/ui/，每个组件独立文件并配套 .demo.tsx 与可选 .test.ts 测试文件
- 营销页面组件位于 src/components/marketing/
- 图标使用 lucide-react，Logo 相关组件在 src/components/icons/

## 响应式与移动端
- 通过 Tailwind 默认断点系统实现响应式布局
- 禁止水平滚动：html, body { overflow-x: hidden; overscroll-behavior-x: none }
- 移动端视口配置：width=device-width, initialScale=1, maximumScale=5

## 约束与约定
- 所有新增样式必须通过 CSS 变量或 Tailwind 原子类表达，禁止硬编码颜色值
- 组件 className 必须经 cn() 函数处理，确保类合并安全
- 设计令牌变更需同时更新明暗两套变量定义
- 滚动条样式通过全局 * 选择器统一覆盖，隐藏滚动条使用 .scrollbar-hide 类