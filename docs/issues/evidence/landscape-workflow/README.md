# 1920×1080 横屏全链路验收

验收日期：2026-07-26  
验收项目：`384c4545-0da9-444e-b88b-a54bd60a2129`  
项目名称：`横屏合同最终验收 2026-07-26 C`

> `docs/designs/canvas.pen` 按用户本轮指示暂不同步，不计入本次工程验收范围。

## 1. 真实工作流

命令：

```powershell
pnpm verify:e2e --base-url "http://localhost:3102" `
  --text "PurpleInk 将经过验证的产品事实和真实演示证据合成为可审查、可重复的横屏发布视频。" `
  --title "横屏合同最终验收 2026-07-26 C" `
  --timeout 900 `
  --report "docs/issues/evidence/landscape-workflow/smoke-report.json"
```

结果：

- `ok: true`
- 9/9 个工作流节点成功，失败节点为 0
- 33 个 Artifact，24 个已提交不可变 Artifact
- Artifact 内容哈希复算不一致为 0
- 全流程耗时 208,547ms

机器可读报告：[smoke-report.json](./smoke-report.json)

## 2. FABRICATE 与媒体产物

真实 `director-fabricate` HTML 通过 `inspectFabricateSource()`：

- viewport：`width=1920, height=1080`
- `data-composition-id`：恰好 1 个
- 根画布：`data-width="1920"`、`data-height="1080"`
- 违规列表为空

`ffprobe 8.1.1` 结果：

| 产物 | Artifact ID | 编码/尺寸 | 帧率与帧数 | SHA-256 |
| --- | --- | --- | --- | --- |
| 镜头 MP4 | `724538a6-4fcf-45e8-9c2c-604e19bbf9e8` | H.264, 1920×1080 | 30fps, 230 帧 | `c734b0d5e914b18483a42e7b2392f2631176f5a111cd69d5aafe2cabe50feec5` |
| 最终 MP4 | `17d608df-0289-4b54-a050-0d384872fbad` | H.264, 1920×1080 | 30fps, 230 帧 | `efef5011b52d9f12fcd8125ea95cc6fed40a3d7b602e72fb230641e1f8328623` |
| 抽帧 PNG | `1f4fc3e5-1295-4824-8a89-194d216c09cf` | PNG, 1920×1080 | — | `a1f2f47a7e0a1f3cc98293b1c3153ff25967d3ec1e08c53f146d60ae70677e76` |
| FABRICATE HTML | `972ac765-507c-4aee-9764-a718e1e7d7f4` | UTF-8 HTML | — | `546a86add09b5ba85e50462916769c2f91d357224024057e58a573ea6e4e45f3` |

文件字节数与数据库报告一致。镜头与最终 MP4 时长均为 7.666667 秒。

## 3. 真实 Chromium 页面

使用本机 Google Chrome 无头模式检查 1440×900 与 900×900：

- 镜头主媒体框均为严格 16:9，视频固有尺寸为 1920×1080，`object-fit: contain`
- 8 张缩略图均为 16:9；900px 宽度下按 4×2 换行
- 导出媒体框为 640×360，视频固有尺寸为 1920×1080
- 三档按钮逐项显示：
  - 高清：1920×1080
  - 标清：1280×720
  - 流畅：960×540
- 两种宽度下 `document.scrollWidth === innerWidth`
- 控制台错误与页面错误均为 0

截图：

- [镜头页 1440px](./shot-1440.png)
- [镜头页 900px](./shot-900.png)
- [导出页 1440px](./export-1440.png)
- [导出页 900px](./export-900.png)

## 4. 工程门禁

通过：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`：115 文件、561 测试通过
- 横屏缩略图 PG 集成：3/3 通过
- 排除并行认证元数据旧清单后的 PG 套件：15 文件、86 测试通过
- 隔离目录 `pnpm build`：成功
- U+FFFD 扫描：无命中

当前工作树的全量门禁仍有两项与本横屏改动无关的并行阻塞：

1. `schema-metadata.pg.test.ts` 尚未纳入并行认证功能新增的 5 张表、4 个外键和 1 个唯一约束，4 项旧清单断言失败。
2. 并行未提交文件 `scripts/verify/e2e-smoke.ts` 为 351 行，超过 `verify:v3` 的 350 行硬上限；`server/.env.example` 的并行改动含行尾空格，导致全工作树 `git diff --check` 失败。

本次没有修改或提交上述并行工作。
