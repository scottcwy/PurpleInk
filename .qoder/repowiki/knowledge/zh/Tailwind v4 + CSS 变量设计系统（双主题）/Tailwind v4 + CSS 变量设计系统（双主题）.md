---
kind: frontend_style
name: Tailwind v4 + CSS 变量设计系统（双主题）
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
    - src/lib/theme-mode.ts
    - src/components/ui/button.tsx
---

## 样式体系概览

项目采用 **Next.js App Router + Tailwind CSS v4** 作为前端样式核心，通过 CSS 自定义属性（CSS Variables）构建完整的设计令牌系统，并基于 `next-themes` 实现浅色/深色双主题切换。

## 技术栈与工具链
- **框架**: Next.js 16 + React 19
- **样式引擎**: Tailwind CSS v4（通过 `@tailwindcss/postcss` 集成）
- **主题管理**: `next-themes`（`ThemeProvider` 包裹根组件，`attribute="class"` 模式）
- **原子类合并**: `clsx` + `tailwind-merge`（通过 `cn()` 工具函数）
- **动画库**: GSAP (`gsap`) + Framer Motion (`motion`)
- **图标**: `lucide-react`
- **字体**: Google Fonts Geist Sans/Mono，通过 `next/font/google` 注入 CSS 变量

## 设计令牌架构

### 双层令牌结构
1. **基础层** (`globals.css`): 定义通用 CSS 变量（background、foreground、border、ring、accent 等），并通过 `.dark` 类覆盖暗色值
2. **应用层** (`design-system.css`): 定义产品级设计令牌（`--ds-*` 前缀），包括渐变、表面、边框、文本、主色、画布等
3. **Canvas 专用层**: 在 `:root` 中定义 `--color-*` 系列变量（accent/success/warning/danger/purple/teal 及 stage-ingest/direct/shotspec/shot/audio/assemble/finalize 等阶段色）

### 主题切换机制
- 根布局 (`layout.tsx`) 通过内联脚本在 hydration 前检测系统偏好并设置 `document.documentElement.classList.add('dark')`
- `providers.tsx` 使用 `next-themes` 的 `ThemeProvider` 管理运行时主题切换，存储键为 `theme-mode`
- `lib/theme-mode.ts` 提供主题模式枚举、标签、状态机（light → dark → system 循环）和解析逻辑

### Tailwind 映射
通过 `@theme inline` 将 CSS 变量映射到 Tailwind 语义化颜色名（如 `--color-background`、`--color-accent`、`--color-ds-surface` 等），使设计令牌可直接在 JSX 中使用 `bg-background`、`text-ds-text` 等类名。

## 组件样式约定

### UI 组件 (`src/components/ui/`)
- 所有组件遵循 **SSOT（Single Source of Truth）** 原则：外观配方集中在组件文件内，通过 `buttonClassName()` 等工厂函数统一生成类名
- 变体系统：以 `variant` prop 驱动（如 Button 的 `primary | tinted | gray | destructive`），尺寸通过 `size` prop（`sm | md | lg`）控制
- 交互态：使用 Tailwind 的 `hover:`、`active:`、`focus-visible:` 修饰符，禁用态统一用 `disabled:pointer-events-none disabled:opacity-45`
- 可访问性：全局 `focus-visible` 样式定义在 `globals.css`，组件默认移除 outline 并通过 ring 替代

### 营销组件 (`src/components/marketing/`)
- 独立于产品 UI 组件，用于着陆页和营销页面
- 包含动画密集型组件（fluid-cursor、image-reveal、smooth-scroll、text-reveal）

## 响应式策略
- 移动端优先：未显式发现媒体查询断点，依赖 Tailwind 的响应式前缀（`sm:`、`md:`、`lg:`）
- 视口配置：`viewport` 元数据允许最大缩放 5x，支持 `device-width`
- 滚动行为：全局启用 `scroll-behavior: smooth`，禁止横向溢出（`overflow-x: hidden`）

## 无障碍与动效
- 跳过导航链接 (`.skip-to-content`) 提供键盘可达的快速跳转
- 全局 `prefers-reduced-motion` 媒体查询强制所有动画时长 ≤ 0.01ms
- 自定义滚动条样式（`scrollbar-width: thin`、圆角拇指、悬停高亮）
- 行裁剪工具类 (`.line-clamp-2`、`.line-clamp-3`) 用于多行文本截断

## 代码组织约束
- CSS 仅存在于 `src/app/globals.css` 和 `src/app/design-system.css`，组件内不使用 CSS Modules 或 styled-components
- 无独立的 `tailwind.config.js`，全部配置通过 CSS `@theme` 指令声明（Tailwind v4 特性）
- PostCSS 仅注册 `@tailwindcss/postcss` 插件，无额外处理器
- Prettier 通过 `prettier-plugin-tailwindcss` 自动排序 Tailwind 类名