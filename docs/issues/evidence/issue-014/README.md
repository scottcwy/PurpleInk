# ISSUE-014 证据 · 第一轮极小闭环（G1–G6 全通过）

首次完成「纯文本 → 成片 MP4」全链路，全部使用真实 Gemini + StepFun API、真实
Chromium 逐帧截取、真实 ffmpeg 编码与拼接，无 fixture、无 mock。

## 运行参数

| 项 | 值 |
| --- | --- |
| 稿件 | `smoke-script.txt`（2 段，短句 16 字 / 长句 89 字，切分后 3 个 script unit） |
| 入口 | `POST /api/projects` → `POST /api/director/pipeline`（autopilot） |
| 运行进程 | `pnpm start --port 3100`，`CVC_NEXT_DIST_DIR=.data/next-e2e` 隔离构建目录 |
| 母版 | 1080×1920 @ 30fps |
| 墙钟 | 223.9 s（19 节点全终态） |
| 报告 | `smoke-report.json` |

## 结果

19 个节点**全部 `succeeded`**，含此前从未运行过的 `score`（ASSEMBLE）与
`export`（FINALIZE）两个全局节点。

产物清单（54 条不可变产物哈希逐条核对一致，19 条实时会话日志单列）：

| kind | 条数 | 说明 |
| --- | --- | --- |
| `director-ingest` | 1 | 切分 + 实测旁白 manifest / allocation |
| `narration-audio:U001..U003` | 3 | 真实 StepFun TTS 字节 |
| `director-direct` | 1 | master plan + style bible |
| `director-shot-spec` | 3 | **3/3 成功**（修复前为 6/39） |
| `director-fabricate` | 3 | 确定性 HTML |
| `render-mp4` | 3 | 单镜成片 |
| `frame-thumbnail` | 9 | **首次产出**（3 镜 × 25%/60%/95%） |
| `qa-vision-report` | 3 | **首次产出**，视觉 QA 真实执行 |
| `subtitle-track` | 3 | 真实 ASR |
| `final-mp4` | 1 | **首个成片** |

## ffprobe 与帧数一致性

| 产物 | 分辨率 / fps | 帧数 | 时长 | 字节 SHA-256 与 `content_hash` |
| --- | --- | ---: | ---: | --- |
| `render-mp4` S001 | 1080×1920 @30 | 89 | 2.967 s | 一致 |
| `render-mp4` S002 | 1080×1920 @30 | 249 | 8.300 s | 一致 |
| `render-mp4` S003 | 1080×1920 @30 | 296 | 9.867 s | 一致 |
| `final-mp4` | 1080×1920 @30 | **634** | 21.133 s | 一致 |

89 + 249 + 296 = **634**，与成片帧数逐帧吻合；21.133 s = 634 / 30。
三镜帧数互不相同，且各自由该 unit 的实测旁白时长决定（ISSUE-005 的时长真值链
在成片上得到端到端确认）。

## 门禁

| 项 | 结果 |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` | exit 0 |
| `pnpm test` | 111 files / 534 passed |
| `pnpm test:pg` | 16 files / 89 passed（首次全绿） |
| `pnpm verify:v3` | `ok: true`，`violations: []` |
| `pnpm build` | exit 0 |
| `git diff --check` | exit 0 |

## 如实标注的偏差

1. **`pi-session` 的 `content_hash` / `size_bytes` 是登记时刻快照，不等于最终字节。**
   会话在开始时即登记（保证失败也可追溯），随后 JSONL 持续 append：实测登记
   192 字节、最终 4.9 KB–66 KB。因此冒烟脚本把它单列为「实时会话日志」，断言
   「文件存在」而非哈希等值，不冒充一致。**这是一条未修复的真值缺口**，建议在
   会话 close 后补登最终版本，属独立议题。
2. **`ffprobe` 来自系统安装（winget `Gyan.FFmpeg`），仓库不自带。**
   `ffmpeg-static` 只提供 `ffmpeg.exe`。白盘或 CI 复现需先自备 `ffprobe`。
3. **第二轮（4–6 镜、并发观测、真实 Chromium 截图）尚未执行**，本目录只覆盖
   第一轮 G1–G6。
4. 运行使用隔离构建目录以避开同工作区正在运行的 dev server，
   未与之争用 `.next`。
