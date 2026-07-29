---
kind: frontend_style
name: Tailwind v4 + CSS 变量设计令牌体系
category: frontend_style
scope:
    - '**'
source_files:
    - src/app/globals.css
    - src/app/design-system.css
    - src/lib/utils.ts
    - src/lib/theme-mode.ts
    - src/components/ui/button.tsx
    - postcss.config.mjs
    - next.config.ts
    - package.json
---

本项目采用 Next.js App Router + Tailwind CSS v4 作为前端样式体系，通过 CSS 自定义属性（CSS Variables）构建完整的设计令牌系统，实现浅色/深色主题与组件级样式的统一管理。

## 样式架构与工具链

- 构建流程：PostCSS 仅配置 @tailwindcss/postcss 插件，由 Tailwind v4 原生处理 CSS；next.config.ts 中未启用 CSS Modules，全局样式通过 globals.css 和 design-system.css 注入。
- 类名合并策略：所有组件统一通过 src/lib/utils.ts 导出的 cn() 函数（基于 clsx + tailwind-merge）合并 className，避免 Tailwind 类冲突。
- 图标与动效：使用 lucide-react 提供图标，gsap、motion、lenis 负责页面级动画与滚动效果。

## 设计令牌体系

样式令牌分为三层，全部以 CSS 变量形式定义：

1. 基础层（globals.css）：定义 --background、--foreground、--accent、--ring、字体族、阴影、圆角等通用令牌，并通过 @theme inline 映射到 Tailwind 的 --color-* 命名空间。
2. 应用层（design-system.css）：定义 --ds-surface、--ds-text、--ds-primary、--ds-blue 等业务语义色，以及 .ds-primary-button、.ds-app-gradient、.ds-dot-grid 等可复用样式类。
3. Canvas 专用层（globals.css 中的 CodeVideoCanvas tokens）：为视频编辑画布定义 --color-stage-ingest、--color-stage-direct、--color-canvas-bg、--color-player-bg 等阶段/媒体相关令牌，并分别给出 light/dark 两套值。

主题切换通过 src/lib/theme-mode.ts 管理三种模式（light/dark/system），在 document.documentElement 上切换 dark class，配合 :root 与 .dark 选择器覆盖变量值。

## 组件样式约定

- UI 原子组件集中在 src/components/ui/，每个组件独立文件并附带 .demo.tsx 与可选的 .test.ts。按钮组件 button.tsx 明确定义了 4 种变体（primary/tinted/gray/destructive）与 3 种尺寸（sm/md/lg），并通过 buttonClassName() 暴露给链接型操作复用。
- 业务组件按功能域组织在 src/features/*/ 下，不直接依赖样式库，而是消费设计令牌。
- 营销页面组件位于 src/components/marketing/，使用 GSAP 与 Lenis 实现滚动驱动动画。

## 响应式与可访问性

- 响应式通过 Tailwind 断言类（如 md:、lg:）实现，无自定义媒体查询。
- 可访问性基线：focus-visible 统一使用 --ring 描边，提供 .skip-to-content 跳过链接、.scrollbar-hide 隐藏滚动条、prefers-reduced-motion 媒体查询禁用动画。

## 约束与规范

- 所有新增 UI 组件必须放在 src/components/ui/ 或对应 feature 目录，禁止在页面文件中直接写内联样式。
- 颜色必须引用设计令牌变量，禁止硬编码十六进制值（除 token 定义本身）。
- 类名合并必须通过 cn() 函数，不得直接使用字符串拼接。
- 主题切换仅通过 dark class 控制，禁止在运行时修改 CSS 变量值。