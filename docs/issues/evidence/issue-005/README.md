# ISSUE-005 取证 · 真实旁白时长实测

- 取证日期：2026-07-25
- 修复提交：`171f692 fix(director): ISSUE-005 把真实 TTS 前移到 INGEST，时长改为实测`
- 环境：本地 Next dev（`http://127.0.0.1:3000`）、`purpleink-dev-postgres-1`、
  StepFun 凭据来自 DB 加密存储（`provider_credentials.provider='stepfun'`，verified）
- 真实调用：Gemini（INGEST 切分）+ StepFun `stepaudio-2.5-tts`（旁白合成），无 fixture、无 mock

## 1. 长短文本得到不同时长与不同帧数

稿件刻意包含一段 9 字与一段 79 字。完整数据见
[`ingest-measured-durations.json`](./ingest-measured-durations.json)。

| unit | 文本长度 | manifest `durationMs`（实测） | `ffprobe` 时长 | 差值 | 是否 ≤1 帧 | shot | `durationInFrames` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| U001 | 9 | 2281.958 ms | 2304 ms | +22.04 ms | 是（<33.3 ms） | S001 | **69** |
| U002 | 79 | 14473.958 ms | 14496 ms | +22.04 ms | 是（<33.3 ms） | S002 | **435** |

- 两个 unit 时长相差 6.3 倍，帧数 69 ≠ 435，修复前恒为 240 帧 / 8000 ms。
- 恒定 +22.04 ms 差值 = 529 samples @ 24 kHz，是 MP3 解码器延迟：
  `ffprobe` 报的是帧计数时长，本仓库实测的是解码后可听采样数（gapless 裁剪后），
  两者关系稳定且在 ±1 帧公差内。`ffprobe` 原始输出见
  [`ffprobe-raw.md`](./ffprobe-raw.md)。

## 2. `content_hash` 来自实际字节

| 对象 | DB `content_hash` | 实际字节 SHA-256 | 一致 |
| --- | --- | --- | --- |
| `director-ingest` | `71cbeed1…50c2af` | `71cbeed1…50c2af` | 是 |
| `narration-audio:U001` | `9304d15b…d5fa85` | `9304d15b…d5fa85` | 是 |
| `narration-audio:U002` | `33616e72…358537` | `33616e72…358537` | 是 |

manifest 里每个 unit 的 `sha256` 字段与上表一致，`sizeBytes` 与磁盘文件一致。

## 3. manifest 与 allocation 的真实口径

```json
{
  "engine": "stepaudio-2.5-tts",
  "voice": "cixingnansheng",
  "contractVersion": "vnext-audio-v1",
  "totalMs": 16755.916666666668,
  "alignmentReport": {
    "policy": "unit-files",
    "scriptCoverage": 1,
    "continuousCoverage": true,
    "lowConfidenceUnitIds": []
  },
  "fps": 30,
  "totalFrames": 504
}
```

`allocationMethod` 为 `unit-boundary`（每个分镜正好覆盖一个完整音频文件的边界），
per-unit `alignment.mode` 为 `unit-file`、`coverage` 为 1。
这些枚举值在 `schemas/ingest.ts` 中原本就存在——旧代码用的是同一 schema 里的
**回退枚举** `duration-weight-fallback`，因此本次修复不需要新增 `measured` 枚举，
只需改为如实使用既有的真实口径。

## 4. 同文本命中已有音频字节，不重复计费

复位 INGEST 节点状态后按真实 API 重跑（数据见
[`reuse-and-negative.json`](./reuse-and-negative.json)）：

| 项 | 结果 |
| --- | --- |
| `narration-audio:U001` / `U002` | 各新增 version 2 索引 |
| `storage_key` 两次是否相同 | 是（`sameStorageKeys: true`） |
| `content_hash` 两次是否相同 | 是（`sameContentHashes: true`） |

storage key 由 `sha256(engine \| voice \| text)` 内容寻址；TTS 输出并非确定性，
若第二次真的重新合成必然得到不同字节与不同 hash。两次 hash 完全一致即证明
命中了已落盘字节，没有再次调用 TTS。

> 说明：重跑前用 SQL 仅把节点 `status` 复位为 `idle`（模拟重试），
> 音频、产物与索引全部由真实代码路径产生。

## 5. 负向验证：无 TTS 凭据必须失败且零产物

删除 `provider_credentials` 中的 stepfun 行后跑一个新项目的 INGEST：

| 项 | 结果 |
| --- | --- |
| job 终态 | `failed` |
| 节点 `status` | `failed` |
| `directorError` | `{"stage":"INGEST","message":"尚未配置 StepFun API Key"}` |
| `director-ingest` 产物 | **无**（`hasIngestArtifact: false`） |
| `narration-audio:*` 产物 | **无**（`hasNarrationArtifact: false`） |

没有任何 8 秒占位被写出。验证后立即用
`pnpm tsx scripts/setup/bootstrap-credentials.ts` 从 `.env.local` 恢复凭据，
恢复结果已确认（stepfun `verified=true`）。

## 6. 未完成的验收项与原因

验收标准第 3 条还包含「渲出的两个单镜 MP4 时长不同」与
「`shot-sfx` 阶段没有产生第二份语音 artifact」的运行时观测。

- **单镜 MP4**：依赖 ISSUE-002（`fabricateShot` 零调用方，`director-fabricate`
  产物不会生成，render 入队会因缺产物被拒）。ISSUE-002 在本取证时仍为 `open`
  且正由他人并行修改 `src/features/render/**`，本 issue 不越界改那些文件。
  已确认的等价证据：`renderSpec.durationInFrames` 由 allocation 直接决定
  （`stage-result.ts` FABRICATE 分支），而 allocation 的 69 / 435 已实测取证；
  `render-shot-repository.ts` 用同一 `renderSpec` 作为逐帧循环次数与 ffmpeg 帧数上限。
- **`shot-sfx` 不产生第二份语音**：代码层面已无第二条合成路径
  （`voiceover.ts` 已删除，全仓库 `generateVoiceover` 零命中，
  `stage-effects.ts` 的 shot-sfx 分支只调 `loadNarration` 做核验）。
  单测 `stage-effects.test.ts` 锁定该行为。运行时观测同样等 ISSUE-002 打通后补。

不声称已验证上述两项运行时观测。

## 7. 复现方式

```powershell
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm tsx scripts/setup/bootstrap-credentials.ts   # 需 .env.local 内 GEMINI_API_KEY / STEPFUN_API_KEY
pnpm dev                                          # 后台常驻
# 建项目（含一段短句 + 一段长句）-> POST /api/director/stage {stage:'INGEST'}
# 读 director-ingest 产物，对每个 audioManifest.units[].audioFile 跑 ffprobe 比对
```
