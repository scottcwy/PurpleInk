# PurpleInk UI Platform Spec

> 状态：Accepted v2  
> 日期：2026-07-24  
> 范围：仓库根目录的营销站、认证页与产品控制台  
> 品牌事实源：`DESIGN.md`  
> 产品行为事实源：`docs/specs/2026-07-23-product-flow-launch-video-system.md`  
> 路由页面编写合同：`docs/specs/2026-07-24-route-ui-authoring.md`

## 1. 冻结结论

PurpleInk 使用一套分层治理的 UI Platform：

| 配置项 | 决策 |
| --- | --- |
| Primitive base | Radix UI primitives |
| Initial style | Nova |
| Product identity | PurpleInk UI |
| Base color | Neutral |
| Styling | Tailwind CSS 4 |
| Theme transport | CSS variables enabled |
| Icons | Lucide |
| Theme | PurpleInk semantic tokens |
| Typography | Geist + Geist Mono |
| ProductFlow canvas | `@xyflow/react` |
| Highlight motion | ReactBits，白名单制 |

`Nova` 只作为 shadcn 生成组件源码时的非规范性结构起点。它不是品牌主题，也不拥有运行时设计权。PurpleInk Token、组件 variants 和本 Spec 才是最终实现合同。对外统一称为 **PurpleInk UI**，不称为 Nova theme。

## 2. 平台职责

- **Radix UI**：提供 Dialog、Popover、Select、Menu 等交互行为、焦点管理和无障碍 primitives。
- **shadcn/ui**：把可维护的组件源码引入仓库，不作为不可修改的二进制依赖或第二套设计系统。
- **Tailwind CSS 4**：负责布局、响应式、状态样式和语义 Token 消费。
- **PurpleInk UI**：拥有组件源码、视觉语言、variants、领域组合和升级决策。
- **ReactBits**：只提供批准范围内的品牌亮点动效，不承担产品操作控件。
- **React Flow (`@xyflow/react`)**：只承担 ProductFlow 节点画板、边、viewport 和选择交互，不成为通用页面布局框架。

营销站、认证页与产品控制台共用 Token 和基础组件。营销站可使用定制叙事布局；认证页和产品控制台优先组合 shadcn 组件。三个表面不得建立互不兼容的颜色、按钮或表单体系。

## 3. 源码与目录

```text
repository root/
  components/
    ui/                  # PurpleInk 基础组件，来源可为 shadcn
    control-plane/       # 控制台领域组合
    auth/                # 认证领域组合
    marketing/           # 营销站组合
    product-flow/        # React Flow nodes、edges、toolbar、inspector
    react-bits/          # 审核后引入的 ReactBits 源码
  app/globals.css        # 语义 Token 的代码事实源
  lib/utils.ts           # cn() 等共享工具
  components.json        # shadcn CLI、alias 与 registry 配置
```

shadcn 生成后，文件视为 PurpleInk 自有源码。升级必须先执行 dry run 和 diff，再人工合并；禁止无审查 `--overwrite`。基础组件不得包含业务请求、权限判断或 Release 状态机逻辑，领域组件不得复制基础 primitive。

## 4. Token 与品牌映射

Token 分为两层：

1. `--pi-*` 保存 PurpleInk 品牌原色和品牌尺寸。
2. shadcn 语义 Token 为组件提供稳定 API。

核心映射如下：

| shadcn semantic | PurpleInk meaning |
| --- | --- |
| `background` / `foreground` | Review Paper / Publication Ink |
| `primary` / `primary-foreground` | Directed Purple / Purple On Color |
| `secondary` | Quiet Surface |
| `accent` | Purple Wash，用于 hover、selection 和低强调表面 |
| `muted` / `muted-foreground` | Quiet Surface / Muted Ink |
| `border` / `input` | Frame Border |
| `ring` | Directed Purple focus ring |
| `proof` / `proof-foreground` | 已验证、已批准、可追溯 |
| `signal` / `signal-foreground` | 变更、阻塞、警告、需要审阅 |
| `destructive` | 删除或不可逆操作；不得与一般 `signal` 状态混用 |

业务 JSX 禁止使用 `bg-purple-*`、原始 Hex 或以色阶名称表达业务状态。`accent` 在 shadcn API 中表示交互强调面，不等于 PurpleInk 品牌主色；品牌主动作使用 `primary`。

PurpleInk 不依赖单一全局圆角表达全部层级：

```css
--radius-compact: 8px;
--radius-control: 10px;
--radius-media: 12px;
--radius-surface: 14px;
--radius-feature: 16px;
```

`--radius-media` 专用于 `DESIGN.md` 冻结的营销 Media Card；产品 surface 使用 `--radius-surface`。Geist 用于正文、标题和控件；Geist Mono 只用于 ID、时间戳、画幅、运行编号和 checkpoint 等机器上下文。中文分别回退到 `DESIGN.md` 规定的 CJK 字体。颜色、对比度、阴影、圆角和排版的规范值以 `DESIGN.md` 为准。

## 5. 组件基线

首批基础组件包括：

- Action：Button、Toggle、ToggleGroup。
- Form：Field、FieldGroup、Input、Textarea、Select、Combobox、Checkbox、RadioGroup、Switch、Slider。
- Navigation：Sidebar、Breadcrumb、Tabs、Pagination、Command。
- Overlay：Dialog、AlertDialog、Sheet、Drawer、Popover、Tooltip、DropdownMenu。
- Data：Table、Card、Badge、Avatar、Separator、ScrollArea。
- Feedback：Alert、Progress、Skeleton、Spinner、Empty、Sonner。

规则：

- 表单使用 `FieldGroup + Field`；校验同时设置 `data-invalid` 与 `aria-invalid`。
- Dialog、Sheet、Drawer 必须有可访问标题。
- 状态必须包含文字或图标，不能只依赖颜色。
- 持久错误和阻塞原因使用 Alert 或页面状态；Toast 只反馈短暂操作结果。
- Card 只用于真实产品实体、表单、节点和媒体，不把页面 section 包装成浮动卡片，不嵌套 Card。
- Button、Input、Select 的主要操作高度至少 48px；工具栏、表格和 Inspector 内的次级紧凑控件可使用 36-40px。
- Lucide 图标通过组件 API 使用；图标按钮必须有 accessible name 和 Tooltip。

## 6. 表单、表格与画板

- 首版表单使用 React 表单状态、Server Actions 和 Zod 服务端边界校验。
- React Hook Form 不进入首版基线；只有出现动态字段数组、复杂客户端联动或可测量的性能问题时，另行 ADR 引入。
- 普通列表使用 shadcn Table 与服务端查询、分页和筛选。
- TanStack Table 不进入首版基线；只有出现列管理、复杂排序筛选或大型交互表格时，另行 ADR 引入。
- ProductFlow 画板固定使用 `@xyflow/react`。节点只呈现标题、Capability、结果缩略图和状态；Actions、Checkpoint、Evidence 与错误进入 Inspector。
- `@xyflow/react` 状态不得成为 Flow 业务事实源。持久化数据仍使用版本化 ProductFlow DSL；viewport、临时选择和拖拽态属于客户端 UI 状态。
- MVP 只支持线性 Flow；不得因为 React Flow 支持分支而提前暴露分支、循环或多人实时编辑。

## 7. ReactBits 白名单

首版只允许 ReactBits 用于：

1. 营销 Hero。
2. 品牌或案例展示。
3. Release 成功完成态。

禁止用于控制台导航、表单、ProductFlow 画板、审批、任务进度、错误和阻塞状态。每个页面最多一个主视觉 ReactBits 效果。Canvas、WebGL 和 shader 必须有显式尺寸容器、延迟加载和静态 fallback；`prefers-reduced-motion` 下不得依赖动画传达内容。控制台禁止自定义光标和指针劫持。

ReactBits 通过批准的 CollectUI registry 引入。Starter 可使用；Pro 只有在有效许可证可用时引入。`REACTBITS_LICENSE_KEY` 只能存放于 `.env.local` 或部署 secret，禁止提交到源码、文档和 `components.json`。

## 8. 可访问性、性能与验收

- 目标 WCAG 2.1 AA，覆盖键盘路径、焦点顺序、可见 focus、名称/角色/状态与颜色独立表达。
- reduced motion 必须保留全部内容和操作，不得只隐藏动画节点。
- ReactBits 不进入关键操作路径；非首屏效果动态加载，不得造成可见布局跳动。
- 固定格式控件和画板使用稳定尺寸、grid tracks 或 aspect ratio，动态状态不得推动主要布局。
- 响应式验收覆盖 360、390、768、1024、1440px 与 200% 缩放。
- 基础组件覆盖 variants、键盘交互、disabled/loading/error 和暗色模式测试。
- 关键流程使用 Playwright 验证键盘操作、Dialog focus trap、响应式、reduced motion 和 ProductFlow 基本画板交互。
- lint、typecheck、单元测试、生产构建和浏览器 smoke test 全部通过后才允许完成迁移。

## 9. 迁移与非目标

迁移按以下顺序增量进行，不整体重写现有页面：

1. 初始化 Radix + Nova 的 shadcn 配置，但不接受其默认品牌视觉。
2. 修复并统一 `globals.css` 的 PurpleInk 双层 Token、字体和暗色映射。
3. 建立基础组件、状态 variants 和组件验收页面。
4. 迁移认证页和控制台 shell，再实现 Product、Release 与 ProductFlow 页面。
5. 最后评估营销站已有自定义组件，只迁移真正共享的 primitives。
6. 按白名单逐项引入 ReactBits，并记录用途、fallback、依赖和许可证状态。

本 Spec 不授权引入 MUI、Ant Design、Chakra、Mantine 或第二套通用 UI 系统；不授权自由时间线、Flow 分支、循环或多人实时编辑；也不要求把所有营销组件改写成 shadcn。现有冻结范围的专项 Spec 在其自身实施期内仍然有效，本 Spec 不追溯扩大那些改动范围。
