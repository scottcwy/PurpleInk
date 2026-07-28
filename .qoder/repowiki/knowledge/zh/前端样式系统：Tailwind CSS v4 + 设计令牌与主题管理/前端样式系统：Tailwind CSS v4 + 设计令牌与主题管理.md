---
kind: frontend_style
name: 前端样式系统：Tailwind CSS v4 + 设计令牌与主题管理
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
    - postcss.config.mjs
    - package.json
    - src/components/ui/button.tsx
---

## 样式体系概览

PurpleInk 采用 **Tailwind CSS v4**（@tailwindcss/postcss）作为核心样式框架，结合 CSS 自定义属性（CSS Variables）构建完整的设计令牌系统，并通过 `next-themes` 实现浅色/深色/跟随系统的三态主题切换。

## 核心技术栈

- **样式框架**: Tailwind CSS v4（通过 `@tailwindcss/postcss` 插件集成）
- **类名合并**: `clsx` + `tailwind-merge` 组合的 `cn()` 工具函数
- **主题管理**: `next-themes` 的 `ThemeProvider`，支持 `light/dark/system` 三种模式
- **字体**: Google Fonts 的 Geist Sans/Mono，通过 `next/font/google` 加载
- **动画库**: GSAP (`gsap`) + Framer Motion (`motion`) 用于营销页面动效
- **图标**: `lucide-react` 图标库

## 设计令牌架构

### 全局令牌（globals.css）
定义了两套完整的 CSS 变量：
- **基础令牌**: `--background`, `--foreground`, `--muted`, `--border`, `--ring`, `--accent` 等
- **CodeVideoCanvas 专用令牌**: `--color-accent`, `--color-success`, `--color-warning`, `--color-danger`, `--color-purple`, `--color-teal` 等业务色彩
- **布局令牌**: `--radius-sm/md/lg/xl/pill`, `--shadow-card/float`, `--duration-fast/base/slow`
- **滚动条令牌**: `--scrollbar-size`, `--scrollbar-thumb`, `--scrollbar-track`

### 设计系统令牌（design-system.css）
独立的 `ds-*` 命名空间令牌，包含：
- 渐变背景、表面色、边框色、文本色
- 业务语义色：`--ds-blue`, `--ds-green`, `--ds-red`, `--ds-amber`, `--ds-magenta`
- 按钮样式：扁平墨色实心风格（Vercel/Linear 式零投影）

### Tailwind 主题映射
通过 `@theme inline` 将 CSS 变量映射为 Tailwind 原子类，如 `bg-background`, `text-foreground`, `rounded-md`, `shadow-card` 等。

## 组件样式约定

### 原子组件（components/ui/）
所有 UI 组件遵循统一模式：
- 使用 `cn()` 函数合并 className，自动处理 Tailwind 冲突
- 通过 `variant` 和 `size` 属性控制外观变体（如 Button 的 primary/tinted/gray/destructive）
- 所有样式基于设计令牌，避免硬编码颜色值
- 提供 `.demo.tsx` 文件用于组件展示和测试

### 业务组件（components/marketing/）
营销页面组件使用更丰富的动画和视觉效果，但仍遵循设计令牌规范。

## 主题切换机制

1. **根布局注入脚本**: `layout.tsx` 在 `<head>` 中注入立即执行的脚本，根据 `localStorage` 或系统偏好设置 `dark` 类
2. **ThemeProvider 包裹**: `providers.tsx` 使用 `next-themes` 的 `ThemeProvider` 管理主题状态
3. **CSS 变量覆盖**: `.dark` 选择器覆盖所有 CSS 变量，实现无缝主题切换
4. **元数据配置**: `viewport.themeColor` 根据配色方案动态设置浏览器主题色

## 响应式与可访问性

- **响应式**: 完全依赖 Tailwind 的断点系统（sm/md/lg/xl）
- **无障碍**: 
  - `skip-to-content` 跳过导航链接
  - `focus-visible` 焦点环样式统一
  - `prefers-reduced-motion` 媒体查询禁用动画
  - 语义化 HTML 结构
- **滚动行为**: 全局平滑滚动，隐藏水平溢出

## 构建与开发

- **PostCSS 配置**: 仅使用 `@tailwindcss/postcss` 插件，保持极简配置
- **Prettier 集成**: `prettier-plugin-tailwindcss` 自动排序 Tailwind 类名
- **Next.js 集成**: 通过 `@import "tailwindcss"` 在 `globals.css` 中引入
- **生产优化**: 移除 console.log（保留 error/warn），禁用 source maps

## 约束与规范

- 所有组件必须使用 `cn()` 函数处理 className
- 禁止硬编码颜色值，必须使用设计令牌变量
- 按钮等交互组件必须提供完整的 variant/size 变体
- 每个 UI 组件需配套 `.demo.tsx` 和可选的 `.test.ts` 文件
- 暗色模式下的所有令牌必须在 `.dark` 选择器中提供对应值