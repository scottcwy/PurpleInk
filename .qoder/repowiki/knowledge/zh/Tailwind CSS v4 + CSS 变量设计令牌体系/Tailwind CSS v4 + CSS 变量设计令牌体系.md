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
    - postcss.config.mjs
    - package.json
---

## 样式系统与架构

本项目采用 **Tailwind CSS v4**（通过 `@tailwindcss/postcss`）作为核心样式框架，结合 **CSS 自定义属性（CSS Variables）** 构建完整的设计令牌系统。样式入口为 `src/app/globals.css`，通过 `@import "tailwindcss"` 引入 Tailwind，并级联导入 `design-system.css` 定义应用级设计令牌。

## 设计令牌与主题系统

### 双层令牌架构
- **基础令牌层** (`globals.css`)：定义通用颜色、字体、阴影、圆角、动画时长等基础变量，如 `--background`、`--foreground`、`--accent`、`--radius-md`、`--duration-base` 等
- **应用令牌层** (`design-system.css`)：定义业务语义化令牌，如 `--ds-surface`、`--ds-primary`、`--ds-blue`、`--ds-canvas` 等，遵循 Vercel/Linear 风格的扁平设计语言

### 暗色模式支持
通过 `.dark` 类切换完整的暗色主题，包含两套独立的令牌值。主题切换由 `next-themes` 的 `ThemeProvider` 管理，默认跟随系统偏好，存储在 `localStorage` 的 `theme-mode` 键中。

### Tailwind 主题映射
使用 `@theme inline` 将 CSS 变量映射到 Tailwind 原子类，使 `bg-background`、`text-foreground`、`border-border` 等类名可直接使用设计令牌。

## 组件库与 UI 约定

### 原子化组件结构
`src/components/ui/` 目录下组织可复用 UI 组件，每个组件配套 `.demo.tsx` 和可选的 `.test.ts` 文件，形成组件-演示-测试三位一体的开发模式。

### 样式组合策略
- 使用 `clsx` 进行条件类名合并
- 使用 `tailwind-merge` 处理类名冲突
- 通过 `lucide-react` 提供图标资源
- GSAP (`gsap`) 和 Framer Motion (`motion`) 用于复杂动画

## 响应式与无障碍

### 响应式策略
- 基于 Tailwind 的断点系统（sm/md/lg/xl）
- 移动端优先的布局策略
- 通过 `viewport` 配置支持缩放（initialScale: 1, maximumScale: 5）

### 无障碍特性
- 全局焦点环样式（`:focus-visible`）
- Skip-to-content 链接
- 减少动画支持（`prefers-reduced-motion`）
- 语义化 HTML 结构和 ARIA 属性

## 构建与工具链

### PostCSS 配置
仅使用 `@tailwindcss/postcss` 插件，保持极简配置。

### 字体系统
使用 Next.js Font Optimization 加载 Geist Sans/Mono 字体，通过 CSS 变量注入字体族。

### 代码规范
- Prettier 统一格式化（含 Tailwind CSS 插件）
- ESLint 配合 `eslint-config-next` 进行代码检查
- TypeScript 严格类型检查

## 关键约束与约定

1. **样式优先级**：CSS 变量 > Tailwind 原子类 > 内联样式
2. **主题一致性**：所有颜色必须通过设计令牌引用，禁止硬编码颜色值
3. **组件样式**：优先使用 Tailwind 原子类，复杂样式才使用 CSS 模块
4. **动画规范**：使用预定义的 `--duration-*` 和 `--ease-*` 变量保证动效一致性
5. **暗色适配**：所有设计令牌必须同时提供 light/dark 两套值