# 新对话 Prompt — PurpleInk 视频生成系统优化

## 项目背景

这是一个 AI 驱动的视频生成系统（PurpleInk），核心链路：URL → 浏览器采集 → 建模 → 章节合成(LLM) → 渲染(ffmpeg) → 视频。

代码在 `d:\Desktop\YE\PurpleInk`，分支 `penguin`，详细交接文档见 `HANDOVER.md`。

## 当前状态

- 5 章节视频结构（opening → hero → showcase → proof → CTA）可正常生成 30s 视频
- 金样本校验 14/15 通过，唯一失败：红绿黄圆点
- HTML Agent 三级 fallback 工作正常
- 全链路耗时约 3 分钟

## 需要解决的问题（按优先级排序）

### 1. 红绿黄圆点修复（P0，最简单）

ch3-showcase.html 中 HTML Agent 生成了 macOS 窗口红绿黄按钮（`.win-head .d1/.d2/.d3`，颜色 `#ff5f57`/`#febc2e`/`#28c840`），导致金样本校验失败。

**修复**：在 `server/src/compose/chapters/html-agent.ts` 的 Forbidden 部分追加禁止规则。

### 2. 截图去重（P2）

当前采集的截图中有内容高度相似的（如两张都是 AI Working 页面），浪费镜头位。需要在 `ai-capture-agent.ts` 的 `shootCurrent` 中，保存前用 perceptual hash 对比已有截图，相似度 > 0.85 则丢弃。

### 3. 长截图滚动效果优化（P3）

fullPage 截图（2000px+）放入 692px 高的 `.viewport` 后，Ken Burns 的 cy 偏移太小（±30~200px），只展示顶部。需要：
- `page-cam.ts` 的预设 cy 范围根据图片实际高度动态计算
- 或在 html-agent prompt 中指示长截图使用 `y: 0 → -(imgHeight - viewportHeight)` 的大范围 translate

### 4. 采集 tab 切换多样性（P1）

AI 在两个 tab 间反复横跳，不去探索其他页面。需要：
- prompt 更明确区分"tab 切换"和"导航链接跳转"
- 或代码层面在 loop_detected 时主动点击导航栏未访问链接

### 5. 新增功能展示章节（P4，最复杂）

用户希望在 ch2-hero（首页展示）之后增加 2 个章节，专门展示采集到的不同功能页面/模块截图。

当前：ch1 → ch2 → ch3 → ch4 → ch5（5 章）
期望：ch1 → ch2(首页) → ch3(功能A) → ch4(功能B) → ch5(截图混排) → ch6(数据/Logo) → ch7(CTA)（7 章）

涉及修改：
- `split.ts`：新增章节类型和映射
- `types.ts`：扩展 ChapterId 联合类型
- `html-agent.ts`：新章节的截图分配策略
- `model.ts`：调整时长分配（7 章需要重新计算每章时长）
- 采集层配合：确保截图来自不同页面（与 P1、P2 联动）

## 注意事项

- **丝滑性红线**：`template.ts` 的 SHOTS 注册表、`page-cam.ts` 的 Ken Burns、`transitions/inject.ts` 不能破坏，这些是动画丝滑性的核心
- **不要新增 ShotDef 到 SHOTS 注册表**：长截图滚动应复用现有 Ken Burns 机制，不要创建新的镜头类型
- **三级 fallback 不能动**：HTML Agent → Legacy LLM → Template Fallback，template-fallback 是安全网
- **金样本校验**：`render.ts` 的 `verifyGolden` 函数，修改后需确保 14/15 不降
- PowerShell 中多命令用分号 `;` 分隔，不能用 `&&`

## 测试命令

```powershell
# 杀进程 + 清缓存
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Remove-Item -Recurse -Force "D:\Desktop\YE\PurpleInk\server\out\cache\*" -ErrorAction SilentlyContinue

# 启动服务
cd d:\Desktop\YE\PurpleInk\server; npx tsx watch src/index.ts

# 提交测试
Invoke-RestMethod -Uri http://localhost:8787/render -Method POST -ContentType "application/json" -Body '{"url":"https://qoder.com/zh","duration":30,"quality":"standard"}' | ConvertTo-Json
```
