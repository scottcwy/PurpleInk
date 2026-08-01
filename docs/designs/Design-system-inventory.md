# Purplelnk Design System Inventory

> Created: 2026-07-23 · Updated: 2026-07-28 · Status: accepted
> Visual SSOT: [`canvas.pen`](./canvas.pen) · Runtime governance: [Architecture Conventions §10](../conventions/architecture-conventions.md#ui-design-ssot)

本文是 `canvas.pen` 的文字索引，记录当前 Canonical 视觉体系、主题变量、组件母版、组合模块、正式页面及同步规则。若本文与设计稿像素或实例树不一致，以已在 Pencil 编辑器中打开的 `canvas.pen` 为准，并在同一次设计变更中回写本文。

> **2026-07-28 同步挂起说明**：本轮"按钮状态系统 + 设置面板体系"重构经用户确认**代码先行**
> （主 CTA 回到深海军蓝、token 去雾提纯、新增 SettingsField 原语、行高 44→48、卡片圆角 12）。
> `canvas.pen` 尚未回写，待下一次 Pencil 编辑器会话以本文件与代码为准同步 B0 母组件。
>
> **2026-07-29**：S3 生产画布已接线 `PipelineNode`（`NodeStatus` + `selected`）；Pencil `Qsovp` 选中态
> 待同一次会话回写。
>
> **2026-07-30**：真实 AI 调用统计新增代码侧 `UsageTrendChart`，登记
> `cumulative-line` 与 `stacked-bars` 两种变体。Pencil MCP 因编辑器未打开
> `canvas.pen` 无法读取 schema，本轮不得绕过加密文件直接修改；B0 母组件与 S1/S6
> 实例同步继续挂起，React、Playbook 与正式路由已按既有 token 合同接线。
>
> **2026-07-31**：S3 画布交互层代码先行：Inspector 收起态由 32px 边条改为
> 悬浮设置圆钮（无右缘边框）、分镜通道面板新增整体最小化（收起为悬浮扳手圆钮）、
> QueueBar 新增 `glass` 变体并以悬浮条浮于 DAG 之上。`canvas.pen` S3 帧与
> `XL8t8` 同步挂起，待下次 Pencil 会话回写。

---

## 1. 权威与依赖链

Canonical 产品设计只允许沿以下链路向下组合：

```text
A · Foundations
  → B0/B1–B3 · Canonical Components
  → C1–C3 · Canonical Compositions
  → S1–S6 · Canonical Routed Screens
```

- **A** 定义 token、字体、密度、图标、内容真实性与同步规则。
- **B0** 保存 reusable mother component；B1–B3 仅展示母组件实例。
- **C** 只组合 B，不重新定义视觉语言。
- **S** 是最终产品效果，只消费 A → B → C。
- **D** 是页面、状态与依赖治理合同，约束 S，不提供平行视觉体系。
- **R2/R3** 是来源档案，只保留 shadcn 结构模板、提示词和探索稿；不得被 S 直接引用，也不参与 Canonical Header 或主题同步。

设计到代码的固定顺序：

```text
Pencil reusable symbol
  → Pencil layout/screenshot verification
  → React reusable component + demo
  → /playbook registry
  → feature/page composition
```

`.pen` 只能通过 Pencil MCP 读取和修改。

---

## 2. 当前画布地图

| 区域 | 内容 | 当前节点 |
|---|---|---|
| A | Foundations | A1 Tokens、A2 Typography & Spacing、A3 Icon & Content Rules、A4 Board Headers & Sync、Scrollbar（`--scrollbar-*` 细条，明暗不同；`.scrollbar-hide` 全隐） |
| B0 | Canonical mother components | 16 个正式 reusable symbols |
| B | Component specimens | B1 Actions & Inputs、B2 Navigation & Feedback、B3 CVC Domain Components |
| C | Stable compositions | C1 Workbench、C2 Pipeline、C3 Inspector |
| D | Governance contracts | D1 Route、D2 State & Feedback、D3 Dependency |
| S Light | 正式浅色页面 | S1–S6，1440×900 |
| S Dark | 正式暗色页面 | S1–S6，1440×900 |
| R2 | Source archive | shadcn source kit，保持原始 token 与外观 |
| R3 | Source archive | generated dashboard explorations + prompts |

当前 `.pen` 共 103 个 reusable 节点：

- **16 个 Canonical reusable symbols**：唯一允许正式页面依赖；
- **87 个 R2 source-kit symbols**：仅为档案与结构参考，不属于产品组件数。

---

## 3. 视觉方向

### 3.1 Porcelain Light

- 纵向渐变由白色过渡到低饱和雾蓝瓷白。
- 表面接近白色但保留轻微冷调，与背景通过 1px 雾蓝边界和克制阴影分层。
- 主操作使用深海军蓝渐变；正文使用墨蓝黑，不以纯黑承担大面积主色。

### 3.2 Obsidian Navy Dark

- 顶部为黑曜石近黑，中段为低亮黑灰，底部逐渐显现深海军蓝。
- 避免高亮蓝紫、霓虹光晕和典型“AI 渐变”；蓝色只用于信息、选中和运行态。
- 卡片使用半透明黑灰表面，边界为低对比石墨灰，正文使用柔和灰白而非刺眼纯白。

### 3.3 语义色纪律

- `ds-blue`：选择、信息、活动执行。
- `ds-green`：已验证、成功、健康。
- `ds-amber`：警告、等待人工复核。
- `ds-red`：失败、危险、阻断。
- `ds-accent`：受控的金属暖色点缀，不替代主操作色。
- 状态不可只靠颜色表达，必须同时有文本标签或图标语义。

---

## 4. Canonical Design Tokens

主题轴统一为 `mode: light | dark`。新 Canonical 组件只使用 `ds-*`、`$transparent` 以及本节明确列出的字体/尺寸变量；旧 `--*`、`pi-*`、Apple-like token 仅为 R2/历史兼容，不得进入新产品组件。

### 4.1 基础表面

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `ds-bg` | `#EEF2FF` | `#03040A` | 页面基底 |
| `ds-surface` | `#FCFDFFF8` | `#11131AF5` | 卡片、顶栏、Inspector、Dialog |
| `ds-surface-muted` | `#F1F4FA` | `#191C26` | 次级面、选中导航、控件轨道 |
| `ds-text` | `#171A2E` | `#F1F1F4` | 主文字 |
| `ds-text-muted` | `#5E6679` | `#9BA0B0` | 次级文字、元数据 |
| `ds-border` | `#DDE2EE` | `#2A2E3C` | 1px 边界与分隔 |
| `ds-shadow` | `#25305A1F` | `#00000099` | Canonical 卡片/浮层阴影色 |
| `ds-ring` | `#3B5BDB59` | `#93A5FF66` | 全控件统一 focus-visible 光环 |

### 4.1.1 滚动条（全局细条）

运行时变量写在 `src/app/globals.css`：`--scrollbar-size`（8px）、`--scrollbar-thumb` / `--scrollbar-thumb-hover` / `--scrollbar-track`。默认对所有可滚动元素生效；浅色拇指偏石墨半透明，深色拇指偏浅灰半透明。需要完全隐藏时用工具类 `.scrollbar-hide`。标本见 `/playbook/foundations`。

### 4.2 页面背景渐变

| Token | Light | Dark |
|---|---|---|
| `ds-gradient-start` | `#FFFFFF` | `#03040A` |
| `ds-gradient-mid` | `#F5F7FD` | `#080912` |
| `ds-gradient-end` | `#E6EAF8` | `#23295C` |

统一配置：线性、纵向、stop `0 / 0.52 / 1`。A–D、Sidebar 与 S1–S6 使用同一组变量；不得为单页另造背景渐变。

### 4.3 主操作

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `ds-primary` | `#202A5B` | `#403778` | Toggle、品牌标及非渐变主色 |
| `ds-button-bg` | `#171A2E` | `#F1F1F4` | Primary 按钮底（墨色，与 `ds-text` 同族） |
| `ds-button-fg` | `#F8FAFF` | `#171A2E` | Primary 按钮前景 |
| `ds-button-bg-hover` | `#252C48` | `#FFFFFF` | Primary 按钮 hover 底 |

Primary 按钮为**扁平实心**（Vercel/Linear 式）：零渐变、零投影、零内高光，浅色模式用墨色、暗色模式反转为近白——按钮色取自 `ds-text` 墨族，与全局平面的瓷白/黑曜表面同源，不引入额外色相（两向对比均 ≥14:1）。交互状态只靠底色明度迁移：hover 换 `--ds-button-bg-hover`、active 下压 `translate-y-px` + `brightness-95`、focus-visible 统一 `ds-ring` 光环。业务页通过 `Button` 变体选用配色，不得本地覆写。语义约定：`primary` = 新建 / 导出等主 CTA；`tinted` = 执行阶段等次主操作；`destructive` = 重渲此镜等高代价操作；`gray` = 取消 / 次级。

### 4.4 信息与状态

| Token | Light | Dark |
|---|---|---|
| `ds-blue` | `#3B5BDB` | `#93A5FF` |
| `ds-blue-soft` | `#E9EEFE` | `#1B2140` |
| `ds-green` | `#168F63` | `#63B28E` |
| `ds-green-soft` | `#E9F8F2` | `#122A22` |
| `ds-amber` | `#B66A18` | `#D9A55E` |
| `ds-amber-soft` | `#F3E7D4` | `#3B2D1D` |
| `ds-red` | `#D92D20` | `#E5534B` |
| `ds-red-soft` | `#FDECEA` | `#3B1D1A` |
| `ds-accent` | `#80663A` | `#C4A15E` |
| `ds-accent-soft` | `#F0E6D2` | `#383020` |

### 4.5 媒体、遮罩与中性 Save

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `ds-scrim` | `#10183A70` | `#02030A99` | S2 模态遮罩 |
| `ds-player-start` | `#26366F` | `#0E0F15` | 播放器渐变顶部 |
| `ds-player-mid` | `#131E48` | `#05060B` | 播放器渐变中段 |
| `ds-player-end` | `#070B20` | `#161A3C` | 播放器渐变底部 |
| `ds-player-fg` | `#EEF2FF` | `#EEF2FF` | 播放器图标 |
| `ds-save-neutral` | `#252836` | `#E8EBF5` | 仅 S6 Save 按钮背景 |
| `ds-save-neutral-fg` | `#F5F6FA` | `#171A2E` | 仅 S6 Save 按钮前景 |
| `ds-save-shadow` | `#1118271F` | `#02061766` | 仅 S6 Save 按钮阴影 |

中性 Save 是唯一批准的页面级按钮色彩例外，但仍通过主题变量实现，不使用实例硬编码 hex。

媒体画幅当前只有一套合同：`1920×1080 @ 30fps` 的 16:9 横屏母版。`MediaViewport`
统一视频、FABRICATE HTML、占位和加载态的黑色 16:9 表面；最终交付只提供
`1920×1080（高清）`、`1280×720（标清）`、`960×540（流畅）` 三档同比例分辨率。
本阶段不提供 9:16 状态或横竖切换控件。

### 4.6 字体与密度

| Token | 值 | 用途 |
|---|---|---|
| `ds-font` | Geist | UI、标题、正文 |
| `ds-mono` | Geist Mono | ID、hash、task ID、artifact、时间码 |
| `ds-radius` | 8 | 默认表面圆角 |
| `ds-gap` | 16 | 默认模块间距 |

常用字号：Display 36、H1 30、H2 22、Body 14、Label 12；正文行高建议 1.45–1.55。圆角：控件 8（`--radius-md`）、卡片/面板/Dialog 12（`--radius-lg`）、pill 999。设置行节奏：导航/只读行 48px（`SettingsRow`，px-5），表单行 `SettingsField`（min-h 56、px-5 py-3.5，label+hint 在左、多控件区在右，窄屏纵向堆叠）——禁止再用行高覆写把多控件塞进 44px 行。

### 4.7 动效（索引）

动效**不从 Pencil 推导**——`canvas.pen` 是静态像素真值，不含时间维度。动效的唯一文字真值是
`docs/conventions/motion-interaction.md`，本节只保留索引，不重复参数。

| 维度 | 值 | 详见 |
| --- | --- | --- |
| 时长 | `fast` 150 / `base` 220 / `slow` 360 / `narrative` 300（仅营销层） | 该文 §2.2 |
| 曲线 | `standard` / `emphasized` / `exit` | 该文 §2.3 |
| 弹性 | spatial 三档（`visualDuration` + `bounce`）；effects 类属性禁用 | 该文 §2.4 |
| 意图表 | 17 条交互意图 → 参数映射 | 该文 §3 |
| 覆盖层 | `OverlayRoot` 双模式（`<dialog>` / Popover API）；Toast 使用独立根级 viewport | 该文 §4 |

token 在 `src/app/globals.css` 分两层落地：`:root` 存语义值，`@theme inline` 用
Tailwind v4 的 `--transition-duration-*` 命名空间导出为 class。
JS 镜像在 `src/lib/motion/tokens.ts`，由 `tokens.test.ts` 的同步测试锁定三处一致。
可交互对照台：`/playbook/motion`（意图标本）与 `/playbook/foundations`（token 对照）。

### 4.8 移动端适配（索引）

`canvas.pen` 目前只有 1440×900 桌面帧，不含移动端像素真值——移动端适配为**代码先行**，
文字真值是 `docs/conventions/responsive-design.md`，本节只索引，不重复参数。

| 维度 | 值 | 详见 |
| --- | --- | --- |
| JS 结构断点 | 900 / 1180 / 1280（`src/lib/layout/breakpoints.ts`） | 该文 §2 |
| 应用壳三态 | hidden ≤899 / rail 900–1279 / expanded ≥1280 | 该文 §3 |
| 编辑器降级 | 画布 <900px 显式降级卡；镜头/导出折叠不降级 | 该文 §4 |
| 触控热区 | 可点元素 ≥40px（`py-N -my-N` 负 margin 技巧） | 该文 §5 |
| 控件尺寸变形 | `Button` sm/md 在 <lg 取 `min-h-10`；`IconButton` <lg 为 40×40、≥lg 仍 32×32 | 该文 §5 |
| safe-area | `--safe-area-inset-*` 由贴屏边 fixed 元素消费（当前唯一消费方：应用壳悬浮导航钮） | 该文 §6 |

---

## 5. Canonical Reusable Symbols（B0）

| Pencil symbol | ID | 责任 | 主题行为 |
|---|---|---|---|
| `SpecBoardHeader/Canonical` | `naY6Q` | A–D 规范板统一标题 | `ds-text / muted / border` |
| `Button/Primary/Canonical` | `QDsSV` | 主操作 | 主题化主渐变 |
| `Button/Outline/Canonical` | `rRzIi` | 次操作 | surface + border |
| `Button/Ghost/Canonical` | `j7HxdL` | 低强调操作 | 透明底 + token 前景 |
| `Field/Canonical` | `AIern` | 单行字段 | surface + border |
| `Textarea/Canonical` | `pAGbj` | 多行源文本 | surface + border |
| `Toggle/Canonical` | `tRDRK` | 布尔状态 | primary track |
| `NavItem/Canonical` | `OD6of` | 导航原子 | muted / selected override |
| `StatusBadge/Canonical` | `G3szjk` | 运行与语义状态 | semantic + soft surface |
| `Progress/Canonical` | `cjFyE` | 离散进度 | muted track + blue fill |
| `AppSidebar/Canonical` | `ViGub` | 唯一应用侧栏 | 与页面同源渐变 |
| `ArtifactChip/Canonical` | `OJzNk` | Artifact 标识/链接外观 | muted surface + mono |
| `InspectorTabs/Canonical` | `N4FZZS` | 固定四页签 | Data / Source / Gates / Execution |
| `ProjectCard/Canonical` | `S1xDL` | 项目摘要 | surface / muted preview |
| `PipelineNode/Canonical` | `Qsovp` | DAG 任务与 checkpoint | surface + semantic status；生产挂载 `/products/canvas/[projectId]`；状态枚举为领域 `NodeStatus`；实例 override 含 `selected`；website 六阶段由数据库执行快照覆盖真实标题、动作文案与既有 stage 色 |
| `QueueBar/Canonical` | `XL8t8` | Trigger/队列摘要 | surface + border；script/audio 可投影套餐并发与排队数，website 只显示数据库确认的“已完成 N/6 阶段”。代码侧增补 `variant="glass"`（半透明 surface + backdrop-blur + 圆角悬浮），S3 画布以悬浮条形式浮于 DAG 之上（`inset-x-3 bottom-3`），视口工具条与小地图相应上移让位 |

规则：

1. 修改颜色优先改 token，不逐个修改实例。
2. 修改结构只改 B0 mother component，再检查 B、C、S 同步结果。
3. 实例 override 只允许内容、状态、图标、选中态和明确登记的尺寸变体。
4. 不新增平行 Button、Card、Badge、Sidebar、Tabs 或 QueueBar。

代码侧补充原语（已登记 `/playbook`，待 Pencil 会话补登记为 reusable symbol）：
`SectionNav`（S6 右栏目录）、`SettingsPanel`（S6 折叠面板；AI 分镜并发使用只读
`SettingsRow + StatusPill`，渲染并发保持独立可编辑）、`SettingsField`（S6 表单行，
2026-07-28 新增，吸收原 SettingsRow 行高覆写场景）、`UsageTrendChart`
（2026-07-30 新增；同一母组件提供会员累计额度阶梯线与账号每日调用堆叠柱；
只接收真实 projection，fixture 仅存在于 `.demo.tsx` 与 `/playbook`）。
`ContextMenu`（2026-07-30 新增；全应用右键菜单的唯一原语。按指针坐标锚定，
区别于 `Popover` 的 trigger rect 锚定，二者不可互代；菜单项为声明式数据，
禁用项必须同时给出文本原因，danger 项图标与颜色双重语义）。
`TimelineTrack`（2026-07-31 补登记；S5 导出页轨道的唯一原语。此前只在
`/playbook` registry 里，本表缺失，属既有 SSOT 缺口）。合同要点：clip 的
`start / width` 是占轨道宽度的比例，**宽度即时长**，禁止退回常量宽；未就绪的
lane 必须留空位而不是让后续 clip 前移，否则 UI 会暗示错误的时间位置；轨道头
固定 124px，只放 ≤2 字轨道名 + 等宽短计数（`meta`），整句状态走 `title`；
`action` 槽承载开关或徽章；`muted` 态必须同时给 `emptyLabel` 之类的文本语义。
全族只用 `ds-blue` 一个色相（浅色 4.89:1 / 暗色 6.78:1，计算值），字号统一
`text-xs`（12px）。

`ArtifactChip` 增补：新增 `download` 开关，置位时渲染 `download` 属性并去掉
`target="_blank"`（二者互斥，同时给会先开空白新标签页再下载）。配套的
`/api/artifacts/[id]?download=1` 返回 `Content-Disposition: attachment`。

---

## 6. 组合模块（C）

| 模块 | 消费组件 | 正式消费点 |
|---|---|---|
| C1 Workbench | Primary Button、ProjectCard | S1、S2 背景 |
| C2 Pipeline | PipelineNode、QueueBar | S3（画布 DAG 节点 UI 唯一消费 `PipelineNode`，禁止 page 内联平行节点壳） |
| C3 Inspector | InspectorTabs、Progress、MediaViewport、状态与预览表面 | S3、S4 |

C 只负责稳定布局与业务组合，不定义新颜色。任何可复用的新 viewer、trace、gate、source、run control 或 status bar，必须先按 N6 顺序加入 B0/B 区，再进入 C/S。

---

## 7. 正式页面与路由合同（S）

| 屏 | 路由/状态 | 主目的 | 主操作 |
|---|---|---|---|
| S1 | `/workbench` | 恢复或创建项目 | New project |
| S2 | `/workbench` New Project state | 创建 durable project | Start planning |
| S3 | `/canvas/[projectId]` | 操作执行 DAG | Run ready nodes |
| S4 | `/shots/[shotId]` | 审查单镜合同与媒体 | Render shot |
| S5 | `/export/[projectId]` | script/audio 验证镜头时间线；website 验证六阶段执行与 approved MP4 | Compose project / 下载 MP4 |
| S6 | `/settings` | 验证 workspace providers/defaults | Save settings |

### 7.1 认证页（L2）的视觉归属

`canvas.pen` 里没有认证屏 —— 登录体系（PLAN-002）落地时新增，此处是它的文字真值。

| 屏 | 路由 | 主目的 | 主操作 |
|---|---|---|---|
| A1 | `/login` | 用已有账号进入 workspace | 登录 |
| A2 | `/signup` | 创建账号与独立 workspace | 创建账号并进入 |
| A3 | `/password/reset` | 用邮件验证码重置口令 | 设置新密码并登录 |

**归属结论：三页用应用侧 `ds-*` token，不用营销侧 token。** PLAN-002 §4.1 原本推荐
营销侧，实施时按实测改为应用侧，依据三条：

1. `--ds-gradient-start` 在浅色是 `#ffffff`、深色是 `#03040a`，与营销侧 `--background`
   **数值相同**。右栏顶部与落地页首屏本来就连续，不需要换阵营才能满足「与落地页风格一致」。
2. `components/ui/*` 的全部控件只认 `ds-*`，且 `canonical-components.test.ts` 断言死了
   这些 class。选营销侧就必须覆盖组件内部 token 或另造一套输入框，正是 AGENTS.md §3
   明令禁止的平行原语。
3. 营销 `Header` 是 `fixed` + `mix-blend-difference` + 全白字，依赖深色 hero 背景，
   搬到认证页会直接失效。因此认证壳自带一行轻量品牌头（`PurpleInkLogo` + 返回首页链接），
   不复用营销 Header，也不构成第二个 shell。

版式：`lg` 及以上左右各半屏，左栏 `public/img/login.webp` 通栏铺满视口高度（`object-cover`），
右栏表单区独立滚动；移动端单栏、海报折叠。三页共用 `(auth)/layout.tsx` 与
`_components/auth-form-shell.tsx`，不复制三份布局。

新增两个组件族（已登记 `/playbook`，只用 `ds-*` token）：

| 组件 | 责任 | 纪律 |
|---|---|---|
| `HumanCheckField` | 算术人机验证的题面 + 答案输入 | 纯呈现；题目与 SVG 由服务端下发，客户端不生成、不校验 |
| `VerificationCodeField` | 邮件验证码输入 + 重发按钮 | 纯呈现；倒计时由父级驱动，与服务端 `auth_throttle` 同一份真值 |

两者都提供非视觉替代：验证题以文本同时呈现并带 `aria-label`，倒计时带
`aria-live="polite"` 文本，不只靠禁用态的视觉变化表达状态（§8）。

微交互（动效参数一律见 `motion-interaction.md`，此处只登记能力与纪律）：

| 能力 | 归属 | 纪律 |
|---|---|---|
| `Button` 的 `loading` | `components/ui/button.tsx` | opt-in 默认关闭；spinner 占图标槽，强制 `disabled` + `aria-busy`，不传时与历史渲染完全一致 |
| `TextField` 的 `error` / `hint` | `components/ui/text-field.tsx` | opt-in；`error` 优先于 `hint`，带 `aria-invalid` + `aria-describedby` |
| `FormFeedback` 行内反馈条 | `(auth)/_components/form-feedback.tsx` | 组合 `Toast` 原语而非另造；`info`/`success` 自动消失（时长取 toast store），`error`/`warning` 常驻待处理 |
| `PasswordStrengthMeter` | `(auth)/_components/password-strength-meter.tsx` | 档位与 `credential-policy.ts` 的 `passwordSchema` 同源；色条 + 文字 + `aria-live` 三重通道 |
| 注册两阶段渐进披露 | `(auth)/_components/signup-form.tsx` | 字段始终挂载（输入值与倒计时不丢），折叠态 `aria-hidden` + `inert` 隔离 Tab 与读屏 |
| 人机验证失败态 | `components/ui/human-check-field.tsx` | `failed` 给出重试引导文本 + 红色双通道；刷新中图标旋转且按钮禁用 |
| 侧栏登出反馈 | `components/ui/sidebar-chrome.tsx` | `pending` spinner 与文案并行；`failed` 5 秒自动复位，期间可立即重试 |
| 认证壳入场 | `(auth)/_components/auth-form-shell.tsx` | 复用共享 `fadeInUp`，不本地写变体；整页导航故无 `exit`；reduced-motion 由根布局 `MotionConfig` 降级 |

客户端实时校验不复制规则：`features/auth/credential-policy.ts` 是邮箱与口令的唯一
Zod 真值，服务端 `schemas.ts` 与认证页的 blur 校验、强度条都从它取同一份定义。

### 7.2 管理后台（L4）的视觉归属

`canvas.pen` 尚无管理后台画板；当前 L4 以本节为文字真值。`admin/layout.tsx`
只负责鉴权、metadata 与 children，不挂载第二套应用壳、Sidebar 或 pathname 高亮映射。
各页使用页面级 `AdminPageFrame` 组织标题和无激活态链接，并只组合 canonical
`Card`、`Button`、`StatusPill`、`EmptyState` 与语义化 table。

状态始终有文本，窄屏表格允许横向滚动，导航触控目标不低于 40px；尚未接线的
用户与计费项显示禁用文案而不是可点击空入口。全部页面使用现有 `ds-*` token，
同时支持 Porcelain Light / Obsidian Navy Dark，不引入后台专属色相、第二套交互状态模型或重复 UI 原语。

共同约束：

- 每屏 1440×900、`clip:true`，Light/Dark 同构。
- 唯一应用壳为 `AppSidebar/Canonical`；页面不得复制 Sidebar 或 TopNav。
- S2 是 S1 上的模态状态，不是独立路由。
- Inspector 固定为 `Data / Source / Gates / Execution`。
- S4 主预览、8 帧条与 S5 成片预览统一使用 16:9；固定
  `1920×1080` FABRICATE iframe 只能由父媒体框等比缩放，不修改 Artifact HTML。
- S5 底部“交付检查”只消费真实 `ExportReadiness`：展示镜头、旁白、字幕、
  QA 计数和阻塞原因；不得用百分比灰块冒充抽帧缩略图，不得把 nodeId 或状态
  文案渲染为 `ArtifactChip`。QA 豁免始终标记为未验收。
- 可见字段必须追溯到 Snapshot、Realtime、artifact/API DTO 或明确的本地 optimistic command state。
- Artifact 外观可点击时必须有真实下载 URL；控件必须有 handler，能力不可用时明确 disabled/empty。
- 不显示 raw assistant delta、Tool 参数值、prompt、credential、provider raw error 或 hidden reasoning。

---

## 8. 状态、内容与可访问性

Canonical 状态集合：`loading / empty / ready / running / succeeded / failed`，另按业务需要表达 `blocked / cancelled / reconnecting`。

- Snapshot 是首次加载、刷新、断线重连和 terminal 对账真源。
- Realtime 只更新 live presentation，不写业务终态。
- 不使用固定假百分比、恒真 QA、永久 Skeleton 或伪造 artifact。
- 文字与表面需保持足够对比度；状态必须有文本，不只靠色相。
- 图标统一使用 Lucide，禁止 emoji。
- 键盘焦点、语义标签和 reduced motion 必须在 React 实现与 `/playbook` demo 中验证。
- JSON viewer 仅用 React text node，限制 depth 6、node 500、copy 64 KiB。

---

### 8.1 工作流错误与限流等待投影

- Streaming Log、节点 Inspector、阶段对话框与项目 Pipeline 必须消费同一份安全错误投影，不得各自拼接供应商原始文案。
- `auto_wait` 是 `pending` 的运行状态：使用 `ds-blue-soft` 或 `ds-amber-soft`，同时显示“系统已自动排队”、恢复时间或倒计时；不得使用红色失败表面，也不得自动弹出失败对话框。
- 画布底部 `QueueStatusBar` 的聚合优先级固定为：失败 → 等待 → 执行中 → 全部完成 → 空闲。失败使用红色 `triangle-alert`，Provider/套餐等待使用琥珀色 `clock-3`，执行中使用蓝色 `loader-circle`，全部完成使用绿色 `circle-check`；每种图标必须同时显示真实计数文案。
- 终态错误对话框依次呈现责任标签、“发生了什么”“系统正在做什么”“你可以做什么”。技术详情默认折叠，只允许供应商、HTTP 状态码、发生时间、阶段和参考号。
- 恢复动作由结构化 `recovery` 字段决定；不得依据错误文案猜测。限流等待只提供切换模型与取消等待，不展示跳过建议。
- 颜色只承担辅助语义：责任标签、等待状态、失败状态都必须同时有可读文本与 Lucide 图标。

## 9. 图标白名单

**应用壳与导航**：`clapperboard`、`layout-dashboard`、`folder`、`waypoints`、`film`、`download`、`settings`

**操作**：`plus`、`save`、`settings-2`、`ellipsis`、`x`、`upload`、`refresh-cw`、`arrow-left`、`chevron-right`、`skip-forward`、`zoom-in`、`zoom-out`、`maximize-2`、`minimize-2`、`folder-open`、`pencil`、`trash-2`、`wrench`（仅 S3 分镜通道面板最小化后的悬浮展开钮）

**执行与内容**：`list-tree`、`sparkles`、`combine`、`file-code`、`audio-lines`、`globe`、`play`、`loader-circle`

**状态**：`circle-check`、`triangle-alert`、`circle-x`、`shield-check`、`info`、`circle-slash`、`clock-3`

尺寸：13–14 用于紧凑元数据，16 用于控件/导航，20–28 用于品牌和卡片预览，44 仅用于播放器中心操作。

---

## 10. 同步与验收清单

每次视觉变更按以下顺序执行：

1. 确认活动编辑器是 `docs/designs/canvas.pen`。
2. 读取 `ds-*` 变量和 B0 reusable symbol，确认未基于陈旧记忆工作。
3. 对受影响根 frame 设置 `placeholder:true`，直接更新现有对象。
4. 修改 token 或 B0 mother component；避免局部实例漂移。
5. 检查 B specimen、C composition、S Light 与 S Dark。
6. 对受影响节点运行 `snapshot_layout` 与 `get_screenshot`。
7. 完成后立即移除 placeholder。
8. 同步本文；代码实施阶段再同步 React token、demo 与 `/playbook`。

验收：

- [ ] Canonical 组件不使用 R2 的 `--*` token。
- [ ] Light 仍为 Porcelain，不因 Dark 调整改变。
- [ ] Dark 为 Obsidian Navy，无高亮蓝紫漂移。
- [ ] 所有正式组件通过同一 `mode` 主题逻辑切换。
- [ ] 仅 S6 两个 Save 使用 `ds-save-*` 中性例外。
- [ ] 播放器与 S2 scrim 使用主题 token，不散落 hex。
- [ ] B0 → B → C → S 同步，无 S → R 依赖。
- [ ] S1–S6 Light/Dark 无裁切、重叠或异常换行。
- [ ] Inspector 四页签顺序和命名固定。
- [ ] R2/R3 外观保持原始，不套 Canonical Header。

---

## 11. 文档归属

| 文档 | 责任 |
|---|---|
| [`canvas.pen`](./canvas.pen) | 视觉像素、变量、reusable symbol、页面 SSOT |
| 本文 | 当前 token、组件、页面与同步规则的文字索引 |
| [`README.md`](./README.md) | `docs/designs` 权威关系与历史/当前文档入口 |
| [`../conventions/architecture-conventions.md`](../conventions/architecture-conventions.md#ui-design-ssot) | 设计到代码的长期架构边界 |
| [`../issues/refactor-v3/issue-n6-ui-truth-and-governance.md`](../issues/refactor-v3/issue-n6-ui-truth-and-governance.md) | N6 实施顺序、测试和证据要求 |
| [`2026-07-23-ui-design-handoff.md`](./2026-07-23-ui-design-handoff.md) | 冻结的 Demo v1 历史执行稿，不再提供当前 token |

Product/Architecture/Harness/Task Breakdown 继续管理产品行为、长期架构、施工协议和状态；本次视觉整理不改变其业务合同或 Track 状态。
