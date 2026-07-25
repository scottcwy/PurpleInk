# PurpleInk 交接文档

## 项目概述

PurpleInk 是一个 AI 驱动的视频生成系统，核心链路：**URL → 浏览器采集 → 建模 → 章节合成(LLM) → 渲染(ffmpeg) → 视频**

当前分支：`penguin`，最新 commit：`411e5f3`

## 当前版本能力（21:39 测试结果）

| 能力 | 状态 | 说明 |
|------|------|------|
| 采集（不登录） | ✅ | tab 切换浏览、fullPage 截图、品牌色提取 |
| 5 章节视频结构 | ✅ | opening → hero → showcase → proof → CTA |
| HTML Agent 生成 | ✅ | 5 章全部 LLM 生成，0 个 template fallback |
| Ken Burns 运镜 | ✅ | scale + translate + power1.inOut |
| 持续动画 | ✅ | 浮动、glow 脉冲、stagger 入场、退出动画 |
| 金样本校验 | 14/15 | 唯一失败：红绿黄圆点 |
| 全链路耗时 | ~3 分钟 | 采集~60s → Model~2s → Compose~90s → Render~30s |

## 待解决问题清单

### P0：红绿黄圆点（金样本唯一失败项）

**现象**：ch3-showcase.html 中 HTML Agent 生成了 `.win-head .d1/.d2/.d3`（macOS 窗口红绿黄按钮），金样本校验要求不包含 `#ff5f57`、`#febc2e`、`#28c840`。

**修复方向**：
- 在 `server/src/compose/chapters/html-agent.ts` 的 `buildAgentPrompt` Forbidden 部分追加：`NO macOS-style titlebar dots (red/yellow/green circles using #ff5f57, #febc2e, #28c840)`
- 或在 `server/src/compose/chapters/validate.ts` 加一条检查：检测到圆点颜色时自动从 HTML 中移除

### P1：采集 tab 切换多样性不足

**现象**：AI 在 AI Coding 和 AI Working 两个 tab 之间反复横跳，不去探索其他页面（如 Pricing、Docs、Blog）。Step 6-8 连续 click ref 15 三次触发 loop_detected。

**根因**：qoder.com/zh 的导航栏 tab 有限，AI 只看到两个内容 tab 就反复切换。Prompt 虽已要求"访问 3 个不同页面"，但 AI 对"不同页面"的理解仍局限于同一区域的 tab。

**修复方向**：
- 在 prompt 中更明确区分"tab 切换"和"导航链接跳转"
- 代码层面：检测连续 click 同一 ref 时，强制注入 `navigate` 到导航栏其他链接的 action
- 或者：在 `ai-capture-agent.ts` 的 loop_detected 兜底逻辑中，不只是 Escape+scroll，而是主动点击导航栏中未访问过的链接

### P2：截图去重

**现象**：4 张截图中 2 张都是 "ai-working"（内容高度相似），浪费展示机会。

**修复方向**：
- 在 `ai-capture-agent.ts` 的 `shootCurrent` 中，保存截图前与已有截图做 perceptual hash 对比
- 相似度 > 阈值（如 0.85）则丢弃，避免重复内容占据有限镜头位
- 需要引入 `sharp` 或类似库做图片相似度计算

### P3：长截图滚动展示效果差

**现象**：当前 fullPage 截图放入 `.viewport`（692px 高）容器后，Ken Burns 的 cy 偏移只有 ±30~200px，对于 2000px+ 的长截图来说只展示了顶部一小部分。

**用户期望**：长截图应该有明显的从上到下滚动效果，展示完整页面内容。

**修复方向**：
- `page-cam.ts` 的 `drift-down-right` 预设 cy 范围需根据图片实际高度动态计算
- 或者：在 `html-agent.ts` 的 prompt 中，对长截图明确指示使用更大的 translate Y 值（如 `y: 0 → -(imgHeight - viewportHeight)`）
- 考虑在 `template-fallback.ts` 中，对长截图使用 `object-fit: contain` 而非 `cover`，让完整长图可见

### P4：ch2-hero 内容定位 + 新增功能展示章节

**现象**：ch2-hero 当前是"画出来的"首页展示（hero 区域），但没有后续章节展示其他功能页面。用户希望 ch2 之后增加 2 个章节专门展示不同功能模块/页面。

**当前章节结构**：
| 章节 | 内容 | 时长 |
|------|------|------|
| ch1-opening | 品牌 Logo + 标题 | ~3s |
| ch2-hero | 大标题 + 副标题 + 按钮 | ~5s |
| ch3-showcase | 截图展示（browser window + Ken Burns） | ~8s |
| ch4-proof | 功能列表 + 数字滚动 + Logo 墙 | ~10s |
| ch5-cta | CTA 大标题 + 命令按钮 | ~4s |

**用户期望的新结构**：
| 章节 | 内容 | 说明 |
|------|------|------|
| ch1-opening | 品牌开场 | 不变 |
| ch2-hero | 首页 Hero 区域展示 | 用截图/画出来的首页 |
| **ch3-feature-a** | **功能页面 A 展示** | 新增：采集到的不同 tab/页面截图 |
| **ch4-feature-b** | **功能页面 B 展示** | 新增：另一个功能模块截图 |
| ch5-showcase | 截图混排展示 | 原 ch3 |
| ch6-proof | 数据/Logo/定价 | 原 ch4 |
| ch7-cta | 结尾 | 原 ch5 |

**修复方向**：
- 在 `server/src/compose/chapters/split.ts` 中新增章节类型
- 在 `server/src/compose/chapters/types.ts` 中扩展 ChapterId 联合类型
- 在 `server/src/compose/chapters/html-agent.ts` 中为新章节定义截图分配策略
- 需要采集层配合：确保截图来自不同页面/模块（与 P1、P2 联动）

## 关键文件索引

| 文件 | 职责 |
|------|------|
| `server/src/capture/ai-capture-agent.ts` | 采集核心：截图决策、tab 切换、loop 检测 |
| `server/src/capture/playwright-driver.ts` | Playwright 驱动：截图、fullPage 压缩 |
| `server/src/compose/model.ts` | 视频模型：截图分配、皮肤选择、故事板 |
| `server/src/compose/chapters/generate.ts` | 章节生成：三级 fallback（HTML Agent → Legacy LLM → Template） |
| `server/src/compose/chapters/html-agent.ts` | HTML Agent：截图策略、prompt 构建 |
| `server/src/compose/chapters/page-cam.ts` | Ken Burns 运镜系统 |
| `server/src/compose/chapters/split.ts` | 章节分配：镜头→章节映射 |
| `server/src/compose/chapters/template-fallback.ts` | 模板降级：纯模板渲染 |
| `server/src/compose/render.ts` | 渲染 + 金样本校验 |

## Git 提交历史（关键节点）

| 时间 | Commit | 说明 |
|------|--------|------|
| 21:39 | `411e5f3` | fullPage 截图压缩 + buildScreenshotPreviews 全量文件 |
| 20:48 | `8f69be7` | 长截图+风格随机+模块切换+CTA修复 |
| 19:47 | `a351e6d` | HTML Agent + 采集默认不登录 + 截图利用率提升 |
| 17:23 | `4915f27` | 时间轴重叠/金样本校验/主题色提取/LLM结构约束 |
