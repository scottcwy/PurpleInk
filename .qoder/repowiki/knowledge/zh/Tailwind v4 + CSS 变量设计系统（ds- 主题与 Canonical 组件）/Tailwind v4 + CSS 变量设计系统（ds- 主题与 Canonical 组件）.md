---
kind: frontend_style
name: Tailwind v4 + CSS 变量设计系统（ds-* 主题与 Canonical 组件）
category: frontend_style
scope:
    - '**'
source_files:
    - src/app/globals.css
    - src/app/design-system.css
    - src/app/providers.tsx
    - src/lib/theme-mode.ts
    - src/lib/utils.ts
    - postcss.config.mjs
    - package.json
    - docs/designs/Design-system-inventory.md
    - src/components/ui/button.tsx
---

## 1. 体系概览
- 样式框架：Tailwind CSS v4（通过 `@tailwindcss/postcss` 插件），配合 PostCSS 构建。
- 主题机制：CSS 自定义属性 + Tailwind `@theme inline`，在 `src/app/globals.css` 中集中声明 Light/Dark 两套 token，并通过 `.dark` 类切换。
- 运行时主题：`next-themes` 作为 ThemeProvider，默认跟随系统，存储 key 为 `theme-mode`；`src/lib/theme-mode.ts` 提供模式切换、解析与标签逻辑。
- 原子类合并：`clsx` + `tailwind-merge` 封装为 `cn()`（`src/lib/utils.ts`），所有组件统一通过该函数合并 className。

## 2. 核心文件与包
- 全局样式入口：`src/app/globals.css`（引入 Tailwind 与 design-system.css，定义基础色板、阴影、圆角、动效、滚动条、focus-ring、line-clamp 等）
- 设计系统 token：`src/app/design-system.css`（`--ds-*` 系列变量、渐变、按钮渐变、点阵背景、微发光效果）
- 主题提供者：`src/app/providers.tsx`（`ThemeProvider` 包裹根组件）
- 主题工具：`src/lib/theme-mode.ts`（light/dark/system 三态切换与解析）
- 类名合并工具：`src/lib/utils.ts`（`cn()`）
- 配置：`postcss.config.mjs`（仅启用 `@tailwindcss/postcss`）、`package.json`（tailwind v4、tailwind-merge、next-themes、lucide-react、motion 等）
- 设计规范文档：`docs/designs/Design-system-inventory.md`（Canonical 视觉体系、token 表、组件母版、页面契约与同步规则）

## 3. 架构与约定
- Token 分层
  - 基础层：`globals.css` 中的 `--background` / `--foreground` / `--accent` / `--ring` / `--font-sans` 等，映射到 Tailwind `--color-*` 与字体。
  - 应用层：`design-system.css` 的 `--ds-*` 变量（surface、border、text、primary、blue/green/amber/red 语义色、canvas/scrim/player/save-neutral 等），全部通过 `@theme inline` 暴露为 `--color-ds-*`。
  - 业务层：`globals.css` 中的 `--color-stage-*`（ingest/direct/shotspec/shot/audio/assemble/finalize 等阶段色）用于画布 DAG 可视化。
- 暗色模式：通过 `.dark` 选择器覆盖同一组变量，`html.dark` 控制 `color-scheme`，`next-themes` 负责 class 切换。
- 组件原语：`src/components/ui/*` 下的 Button、Card、Dialog、Sidebar、TextField、ProgressBar、StatusPill、PipelineNode 等均为“应用 UI”原子组件，统一消费 `ds-*` token，并通过 `buttonClassName` 等配方函数输出一致外观。
- 组合与页面：`src/features/*` 按功能域组织（auth、canvas、director、render、audio、navigation 等），页面路由位于 `src/app/(auth)`、`src/app/(marketing)`、`src/app/products` 等 Next.js App Router 分组。
- 图标与动效：图标统一使用 `lucide-react`；动效使用 `motion`（Framer Motion）与 GSAP（营销页），并尊重 `prefers-reduced-motion`。
- 设计到代码的契约：`docs/designs/Design-system-inventory.md` 规定 A→B0→B→C→S 的单向依赖链，禁止平行视觉体系或硬编码 hex。

## 4. 约定与约束
- 颜色与主题
  - 新组件只允许使用 `ds-*`、`$transparent` 及文档明确列出的字体/尺寸变量；旧 `--*`、`pi-*`、Apple-like token 仅限历史兼容，不得进入新产品组件。
  - 状态不可仅靠颜色表达，必须同时有文本标签或图标语义。
  - Primary 按钮统一使用 135° 渐变（浅色浅色系、深色深色系），业务页通过 `Button` 变体选用配色，不得本地覆写渐变。
  - 唯一例外是 S6 Save 按钮使用 `ds-save-*` 中性色，但仍走主题变量。
- 组件与样式
  - 所有组件 className 必须经 `cn()` 合并，避免 Tailwind 冲突。
  - 按钮、卡片、输入框等“应用 UI”原子组件集中在 `src/components/ui/*`，正式页面只能组合这些组件，不得自行实现平行 Button/Card/Badge/Sidebar/Tabs/QueueBar。
  - 滚动条统一细条风格（8px），浅色拇指石墨半透明、深色拇指浅灰半透明；需要隐藏时使用 `.scrollbar-hide`。
- 可访问性
  - 全局 focus-ring 样式（`2px solid var(--ring)`，`outline-offset: 2px`），并提供 `.no-focus-ring` 显式关闭。
  - 支持 `prefers-reduced-motion`，将所有动画/过渡时长压缩至 0.01ms。
  - 认证相关字段（HumanCheckField、VerificationCodeField）需提供非视觉替代（aria-label、aria-live）。
- 媒体与画幅
  - 媒体画幅固定 1920×1080 @ 30fps 横屏母版；MediaViewport 统一视频、FABRICATE HTML、占位与加载态的黑色 16:9 表面；最终交付仅提供 1920×1080 / 1280×720 / 960×540 三档同比例分辨率，不提供 9:16 或横竖切换控件。
- 设计治理
  - 变更顺序严格遵循 Pencil → React 组件 + demo → `/playbook` registry → feature/page composition；`.pen` 只能通过 Pencil MCP 读取修改。
  - 修改颜色优先改 token，不逐个修改实例；修改结构只改 B0 mother component，再检查 B、C、S 同步结果。
  - 验收清单要求 Canonical 组件不使用 R2 的 `--*` token，Light/Dark 无裁切重叠，Inspector 四页签顺序命名固定等。