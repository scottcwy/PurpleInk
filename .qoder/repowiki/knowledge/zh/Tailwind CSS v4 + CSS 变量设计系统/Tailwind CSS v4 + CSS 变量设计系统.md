---
kind: frontend_style
name: Tailwind CSS v4 + CSS 变量设计系统
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
---

## 样式系统与架构

PurpleInk 前端采用 **Tailwind CSS v4**（通过 `@tailwindcss/postcss`）作为核心样式方案，结合原生 CSS 自定义属性（CSS Variables）构建完整的设计系统。样式入口为 `src/app/globals.css`，通过 `@import "./design-system.css"` 引入独立的设计令牌文件。

### 设计令牌体系

项目维护两套并行的设计令牌：
- **CodeVideoCanvas 令牌**（`globals.css`）：面向视频编辑画布的专业色彩体系，包含 `--color-stage-*` 系列阶段色、`--color-canvas-*` 画布色、阴影与圆角等
- **Design System 令牌**（`design-system.css`）：面向通用 UI 组件的 ds-* 命名空间令牌，如 `--ds-surface`、`--ds-primary`、`--ds-blue-soft` 等

两套令牌均通过 `@theme inline` 映射到 Tailwind 的语义化颜色变量（如 `--color-accent`、`--color-background`），实现设计令牌与实用类之间的解耦。

### 主题模式

主题切换基于 HTML 元素的 `.dark` 类实现，支持三种模式：`light` | `dark` | `system`。根布局 `layout.tsx` 通过内联脚本在 hydration 前同步设置 dark 类，避免闪烁。`src/lib/theme-mode.ts` 提供模式切换逻辑和工具函数。

### 组件样式约定

UI 组件位于 `src/components/ui/`，遵循统一约定：
- 使用 `clsx` + `tailwind-merge` 组合 className（通过 `cn()` 工具函数）
- 每个组件配套 `.demo.tsx` 演示文件
- 变体通过 props 控制（如 Button 的 `variant` 和 `size`）
- 所有交互样式（hover、transition）集中在组件内部定义

### 动画与动效

- 基础动画：`globals.css` 中定义 shimmer keyframes 和 `animate-shimmer`
- 高级动效：通过 `gsap` 和 `motion`（Framer Motion）库实现
- 无障碍：`prefers-reduced-motion` 媒体查询自动禁用动画

### 响应式策略

- 移动端优先，使用 Tailwind 断点系统
- 字体通过 Next.js Font Optimization 加载 Geist Sans/Mono
- viewport 配置支持主题色和缩放限制

### 构建与工具链

- PostCSS 仅配置 `@tailwindcss/postcss` 插件
- Prettier 通过 `prettier-plugin-tailwindcss` 自动排序 Tailwind 类
- ESLint 使用 `eslint-config-next` 确保 React/Next.js 最佳实践

## 关键文件

- `src/app/globals.css` - 全局样式与设计令牌定义
- `src/app/design-system.css` - 设计系统令牌与通用样式
- `src/lib/utils.ts` - clsx + tailwind-merge 工具函数
- `src/lib/theme-mode.ts` - 主题模式管理逻辑
- `src/components/ui/button.tsx` - 按钮组件示例（SSOT 模式）
- `postcss.config.mjs` - Tailwind v4 配置
- `next.config.ts` - Next.js 构建与代理配置

## 约束与规范

1. 所有 UI 组件必须从 `src/components/ui/` 目录导入，禁止重复造轮子
2. 样式变更需同时更新对应 demo 文件
3. 设计令牌变更需保持 light/dark 双模式一致性
4. 生产环境移除 console.log（保留 error/warn）
5. 所有外部图片域名需在 next.config.ts 中白名单注册