# PurpleInk 设计系统（飞书版）

> 版本：2026-07-24  
> 状态：当前生产规范  
> 视觉基准：首页  
> 代码源：`app/globals.css`

## 1. 一句话定义

PurpleInk 是一套以黑白空间为结构、以光谱靛青为表达、以数字墨水动效为识别特征的创意科技设计系统。

首页是视觉事实来源。设计系统从首页反向提取，不为了令牌完整而改变首页，也不使用生成色带替换已经上线的颜色。

## 2. 设计原则

### 2.1 Spectral Ink（光谱墨水）

- 黑、白和中性灰负责结构、阅读与层级。
- 靛青负责品牌识别、焦点、选择、主操作和动态能量。
- 靛青可以像墨水、光、胶片或流体一样扩散和变形。
- 页面依赖空间、图像和交互建立层次，不依赖大量悬浮卡片。
- 字体保持克制，让图像和动效承担品牌表达。

### 2.2 首页优先规则

1. 首页当前渲染结果高于文档和生成工具。
2. 已存在的首页 Hex 是生产锚点，不重新计算、不自动替换。
3. ColorBox 只补齐缺失色阶，不修改生产锚点。
4. 组件只使用语义令牌，不在组件内新增 Hex。
5. 新增颜色前，先判断现有中性、靛青、标签、图标或结构是否已经能表达状态。

## 3. 原始颜色（Primitive Colors）

### 3.1 中性结构

| 名称        | Token              | Hex       | 用途                     |
| ----------- | ------------------ | --------- | ------------------------ |
| Pure White  | `--pi-white`       | `#FFFFFF` | 亮色背景、反白文字       |
| Near Black  | `--pi-black`       | `#0A0A0A` | 亮色主题主文字、黑色按钮 |
| Neutral 50  | `--pi-neutral-50`  | `#FAFAFA` | 暗色主题主文字           |
| Neutral 100 | `--pi-neutral-100` | `#F5F5F5` | 浅色弱化表面             |
| Neutral 300 | `--pi-neutral-300` | `#E5E5E5` | 浅色边界、较强表面       |
| Neutral 600 | `--pi-neutral-600` | `#737373` | 浅色次级文字             |

### 3.2 Night 暗色结构

| 名称          | Token                | Hex       | 用途                 |
| ------------- | -------------------- | --------- | -------------------- |
| Night         | `--pi-night`         | `#03040A` | 暗色背景、媒体舞台   |
| Night Asset   | `--pi-night-asset`   | `#030409` | 首页渐变资产最暗端点 |
| Night Glow    | `--pi-night-glow`    | `#0C0E21` | 深色光晕端点         |
| Night Surface | `--pi-night-surface` | `#18181B` | 暗色分组表面         |
| Night Border  | `--pi-night-border`  | `#27272A` | 暗色边界             |
| Night Muted   | `--pi-night-muted`   | `#A1A1AA` | 暗色次级文字         |

### 3.3 Spectral Indigo 品牌靛青

| 名称       | Token             | Hex       | 首页角色                      |
| ---------- | ----------------- | --------- | ----------------------------- |
| Indigo 900 | `--pi-indigo-900` | `#352E82` | Launch CTA 墨水扩散、流体深色 |
| Indigo 700 | `--pi-indigo-700` | `#333DA7` | 光谱渐变起点                  |
| Indigo 600 | `--pi-indigo-600` | `#5160C3` | Footer 光谱中间色             |
| Indigo 500 | `--pi-indigo-500` | `#6366F1` | 主强调、焦点环、ColorBox 锁色 |
| Indigo 400 | `--pi-indigo-400` | `#7388DF` | 光谱渐变终点                  |
| Indigo 300 | `--pi-indigo-300` | `#8C9EE6` | Footer 光谱浅色               |
| Indigo 200 | `--pi-indigo-200` | `#A5B4F0` | Footer 光谱浅端、安静状态     |
| Indigo 150 | `--pi-indigo-150` | `#A5B4FC` | 浅色强调表面                  |

说明：`Indigo 150` 与 `Indigo 200` 很接近，但来源和用途不同。前者是界面浅强调色，后者是首页 Footer 光谱的精确端点，暂不合并。

### 3.4 受限品牌色

| 名称        | Token              | Hex       | 使用边界                       |
| ----------- | ------------------ | --------- | ------------------------------ |
| Proof Green | `--pi-mark-green`  | `#00C37A` | Logo 注册点、已验证/已批准状态 |
| Icon Violet | `--pi-icon-violet` | `#7D3DF3` | Favicon/App Icon 固定底色      |

受限色不是第二套主色。Proof Green 不用于普通主按钮；Icon Violet 不生成界面色带。

## 4. 语义颜色（组件应使用这一层）

| 语义角色            | Light         | Dark          | 含义                 |
| ------------------- | ------------- | ------------- | -------------------- |
| `background`        | White         | Night         | 页面背景             |
| `foreground`        | Near Black    | Neutral 50    | 主文字与高对比内容   |
| `muted`             | Neutral 100   | Night Surface | 弱化表面             |
| `muted-foreground`  | Neutral 600   | Night Muted   | 次级文字             |
| `surface-strong`    | Neutral 300   | Night Border  | 强分组表面           |
| `border`            | Neutral 300   | Night Border  | 常规边界             |
| `ring`              | Indigo 500    | Indigo 500    | 键盘焦点             |
| `accent`            | Indigo 500    | Indigo 500    | 主强调、选择和主操作 |
| `accent-strong`     | Indigo 900    | Indigo 150    | 强调文字或高对比状态 |
| `accent-light`      | Indigo 150    | Indigo 700    | 浅强调表面           |
| `accent-foreground` | White         | White         | 强调色上的文字       |
| `ink-panel`         | Night         | Night         | 媒体/墨水舞台        |
| `ink-panel-soft`    | Night Surface | Night Surface | 暗色次级表面         |
| `ink-panel-text`    | Neutral 50    | Neutral 50    | 暗色舞台主文字       |
| `ink-panel-muted`   | Night Muted   | Night Muted   | 暗色舞台次级文字     |
| `proof`             | Proof Green   | Proof Green   | 已验证/已批准        |
| `proof-ink`         | Night         | Night         | Proof Green 上的内容 |
| `signal`            | Indigo 200    | Indigo 200    | 提醒或待处理状态     |
| `signal-soft`       | Neutral 100   | Neutral 100   | 提醒的弱背景         |
| `signal-ink`        | Indigo 900    | Indigo 900    | 提醒文字             |

## 5. 色彩使用规则

### 5.1 营销首页

- 黑白中性承担版式骨架。
- 靛青可以大面积存在于图像、渐变和流体动效中。
- 文本和导航保持克制，避免所有元素同时变成紫色。
- 只使用一套共享光谱处理，让不同图片属于同一个视觉世界。

### 5.2 产品界面

- 默认使用中性表面；靛青用于主操作、选中、焦点和关键进度。
- Proof Green 只表示“已验证/已批准”，并同时显示文字或图标。
- 警告、失败和待处理不能只依赖颜色；优先使用标签、图标、文案和结构。
- 禁止直接使用 Tailwind 的 `purple-*`、`violet-*`、`slate-*` 代替项目令牌。

### 5.3 品牌效果

| 效果 Token                   | 当前值/组成                             | 用途             |
| ---------------------------- | --------------------------------------- | ---------------- |
| `--brand-launch-ink`         | Indigo 900                              | CTA 点击墨水     |
| `--gradient-brand-spectrum`  | Indigo 700 → Indigo 400，135°           | 主要光谱图像处理 |
| `--gradient-footer-spectrum` | Indigo 700/600/400/300/200 多段透明渐变 | Footer 氛围光    |
| `--gradient-edge-spectrum`   | Indigo 700 → Transparent                | 边缘过渡         |
| `--mask-header-fade`         | Black → Transparent                     | 顶部导航模糊遮罩 |

## 6. ColorBox 生成规范

### 6.1 导入方式

1. 打开 `https://www.colorbox.io`。
2. 点击 `Import`。
3. 选择 `JSON`。
4. 粘贴 `docs/colorbox-import.json` 的完整内容。
5. 点击 `Update`。
6. 保持 `OKLCH` 模式，不在 HSV 与 OKLCH 之间来回切换。

配置会生成四条候选色带：

| 色带            | 锁定 Hex  | 作用                      |
| --------------- | --------- | ------------------------- |
| Spectral Indigo | `#6366F1` | 补齐品牌靛青缺失阶        |
| Neutral         | `#737373` | 补齐亮色中性灰阶          |
| Night Ink       | `#03040A` | 补齐暗色墨水表面阶        |
| Proof Green     | `#00C37A` | 仅补齐验证状态的浅/深变体 |

### 6.2 ColorBox 阶位命名

ColorBox 的 11 个 Major Step 导出后统一映射为：

| ColorBox | 项目色阶 |
| -------- | -------- |
| 0        | 50       |
| 1        | 100      |
| 2        | 200      |
| 3        | 300      |
| 4        | 400      |
| 5        | 500      |
| 6        | 600      |
| 7        | 700      |
| 8        | 800      |
| 9        | 900      |
| 10       | 950      |

### 6.3 靛青导出后的锚点覆盖

ColorBox 每条色带只能锁定一个 Hex，因此导出后必须把以下阶位覆盖为首页生产值：

| 建议阶位 | 必须保留的 Hex | 对应当前 Token           |
| -------- | -------------- | ------------------------ |
| 200      | `#A5B4FC`      | Indigo 150（界面浅强调） |
| 300      | `#8C9EE6`      | Indigo 300               |
| 400      | `#7388DF`      | Indigo 400               |
| 500      | `#6366F1`      | Indigo 500 / Lock Hex    |
| 600      | `#5160C3`      | Indigo 600               |
| 700      | `#333DA7`      | Indigo 700               |
| 900      | `#352E82`      | Indigo 900               |

`#A5B4F0` 继续作为 Footer 光谱的效果专用值保留，不要求塞进标准 50–950 色阶。

### 6.4 中性与 Night 锚点

| 系列        | 必须保留的 Hex                                                   |
| ----------- | ---------------------------------------------------------------- |
| Neutral     | `#FFFFFF`、`#FAFAFA`、`#F5F5F5`、`#E5E5E5`、`#737373`、`#0A0A0A` |
| Night Ink   | `#A1A1AA`、`#27272A`、`#18181B`、`#0C0E21`、`#03040A`            |
| Proof Green | `#00C37A`                                                        |

### 6.5 生成色进入生产的条件

ColorBox 输出默认标记为 Candidate，不自动成为设计令牌。只有同时满足以下条件才能进入生产：

1. 填补了明确的界面状态或层级缺口。
2. 没有替换首页已有锚点。
3. 已映射为语义角色，而不是直接在组件中引用。
4. 正文对比度达到 4.5:1；大文字达到 3:1。
5. 已验证 Light、Dark、Hover、Focus 和 Disabled 状态。
6. 首页截图对比没有发生非预期变化。

## 7. 字体系统

### 7.1 Geist Sans（默认）

```text
Geist, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif
```

适用于标题、正文、导航、按钮和营销文字。Geist 通过 Next.js 在构建时自托管，不依赖运行时第三方字体 CDN。Geist 不包含完整中文字形，因此中文依次回退到苹方、微软雅黑或 Noto Sans CJK SC。

### 7.2 Geist Mono（受限）

```text
"Geist Mono", "Noto Sans Mono CJK SC", ui-monospace, monospace
```

只用于 ID、版本、时间、尺寸、哈希和机器状态，不作为装饰性正文。

### 7.3 当前首页层级

| 层级                 | 尺寸                       | 字重    | 用途             |
| -------------------- | -------------------------- | ------- | ---------------- |
| Hero                 | 36 / 48 / 60 / 72px 响应式 | 500     | 首页核心主张     |
| Section Statement    | 36–72px 响应式             | 500     | 大段品牌陈述     |
| Section Heading      | 24 / 30 / 36px             | 500     | 模块标题         |
| Body                 | 14–18px                    | 400–500 | 正文和说明       |
| Navigation / Control | 14–16px                    | 500     | 导航、按钮、控件 |

正文行长控制在 65–75 个字符内。导航和按钮使用正常大小写，不使用全大写正文。

## 8. 空间与布局

- 基础间距单位：4px。
- 常用间距：8、12、16、24、32、48px。
- 页面横向边距：移动端 16px；小屏 24px；大屏 32px。
- 首页 Hero 内容最大宽度：896px。
- 全局导航、Footer 和主要内容最大宽度：1280px。
- 常规 Section 纵向留白：80px；中大屏可增加到 112px。
- 布局优先使用留白和对齐分组，不为每个区块添加卡片容器。

## 9. 圆角、边界与阴影

| 角色             | 规范                              |
| ---------------- | --------------------------------- |
| Signature CTA    | 64px 高，全圆角 Pill              |
| CTA 尾部操作区   | 48 × 48px 圆形                    |
| Media Card       | 12px 圆角、轻边界、平面容纳       |
| Compact Nav Item | 6px 圆角                          |
| CTA 静态阴影     | `0 8px 32px rgb(0 0 0 / 12%)`     |
| CTA 点击外环     | 1px 白色 72% + 24px 白色 28% 光晕 |
| Focus Ring       | Indigo 500，3px，外偏移 3px       |

表面默认保持平面。阴影主要服务于 CTA、焦点和交互反馈，不用于制造大量漂浮卡片。

## 10. 动效语言

| 场景          | 参数                              | 角色                     |
| ------------- | --------------------------------- | ------------------------ |
| 首屏进入      | 600ms，`[0.25, 0.46, 0.45, 0.94]` | 淡入、上移、由模糊到清晰 |
| CTA 墨水扩散  | 680ms，`[0.4, 0, 0.2, 1]`         | 品牌主反馈               |
| CTA 外环      | 520ms，`[0.16, 1, 0.3, 1]`        | 与墨水同步扩张并消失     |
| 常规状态切换  | 160–200ms                         | 文字、图标、Hover        |
| Hero 滚动响应 | Spring 100 / 30                   | 背景视差与缩放           |

动效必须使用 Transform、Opacity、Blur、Mask 或 Shadow，不通过改变布局尺寸制造抖动。开启 `prefers-reduced-motion` 后使用瞬时状态或淡化反馈，内容不能消失。

## 11. 代表组件

### 11.1 Launch CTA

- 64px 高，全圆角。
- 静态状态为黑白反转结构，尾部为 48px 圆形箭头。
- 点击后 Indigo 900 从尾部扩散，文字切换为 Preparing 状态。
- 外环从按钮外侧轻微扩大，并在 520ms 内完全透明。
- 该几何是品牌签名，不代表所有产品按钮都必须做成 64px Pill。

### 11.2 Media Card

- 12px 圆角。
- 竖向媒体比例优先。
- 使用共享光谱处理统一不同素材。
- 边界弱化，不叠加宽模糊阴影。
- WebGL/CSS 形变只增强交互，不隐藏内容。

### 11.3 Navigation

- 营销首页使用固定、混合模式感知和渐隐模糊遮罩。
- 产品页面可以使用传统实体表面，但必须共享中性、靛青和字体令牌。
- 移动端导航保持大字号、强扫描性和清晰点击区域。

## 12. 无障碍与交付检查

- 正文对比度至少 4.5:1。
- 大文字对比度至少 3:1。
- 颜色状态必须同时提供文字、图标或结构线索。
- 键盘焦点必须可见。
- Reduced Motion 下内容和操作仍完整可用。
- 组件文字在移动端和桌面端不得溢出或遮挡。
- 令牌化改造不得有意改变首页截图。

## 13. 变更流程

1. 在首页或明确的新产品需求中确认颜色来源。
2. 优先复用现有 Primitive。
3. 缺失时用 ColorBox 生成 Candidate。
4. 将 Candidate 映射为 Semantic Token。
5. 组件只引用 Semantic Token。
6. 验证对比度、Light/Dark、Focus、Reduced Motion 和响应式。
7. 对首页执行截图对比。
8. 同步更新 `app/globals.css`、`DESIGN.md` 和本飞书文档。

## 14. 禁止项

- 禁止用 ColorBox 输出覆盖首页现有 Hex。
- 禁止把 Icon Violet 扩展成第二套界面主色。
- 禁止把 Proof Green 用作普通 CTA 或装饰色。
- 禁止新增橙色/红色独立状态色带；先使用标签、图标和现有语义结构。
- 禁止在组件中硬编码项目已有颜色。
- 禁止使用通用 Purple/Violet/Slate 色阶绕过 PurpleInk 令牌。
- 禁止把所有区块做成悬浮卡片。
- 禁止用颜色作为状态的唯一信息载体。
