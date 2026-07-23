# Purple Ink — URL 转演示视频平台 PRD

> 一句话:用户输入一个网址(可含登录墙),系统自动登录/探索/截图,替换 HyperFrames 官方 `Website to Video` 管线的第一步 Capture,复用其 Design→Storyboard→TTS→Compose→Render,产出一支高质量演示视频。
>
> 场景:黑客松现场,给参赛 demo 一键生成演示视频。非商业化。

---

## 1. 目标与非目标

### 目标
- 用户只提供 **URL**(可选:目标站测试账号、脚本、时长/风格),几分钟内拿到一支可下载的 demo 视频。
- **能进登录墙**:官方 Capture 只能抓公开落地页;我们能自动注册/登录后抓到真实产品界面——这是核心差异化。
- **质量第一**:视频质量对齐甚至超过官方管线;不阉割 HyperFrames,完整复用其 Design/Animation/TTS/Render。
- 现场**稳、快、不翻车**:全流程超时兜底,失败也能出一版可用视频。

### 非目标
- 不重写/不 fork HyperFrames 源码;把它当黑盒引擎调用。
- 不做商业化、不做多租户计费。
- 不做用户账号体系(我们产品自身无登录)。

---

## 2. 用户流程

```
用户在 PurpleInk 前端输入:URL(必填) + [测试账号/密码(可选输入框)] + [脚本] + [时长/风格]
        │  POST /api/jobs
        ▼
后端创建任务 → 排队 → 执行管线 → WebSocket 推进度
        ▼
完成:返回 mp4 下载链接 + 缩略图(contact sheet)
```

- 目标站需要登录时:**优先用前端可选输入框里的测试账号**;未填则走 IMAP 自助注册(Firenze 现有能力);都不行则只抓公开页并提示。

---

## 3. 系统架构

```
[PurpleInk 前端(已完成)]
        │ REST + WebSocket
        ▼
[后端编排服务 (Node/TS)]
   ├── 任务队列(串行/小并发,现场用一台机)
   ├── ① Firenze Capture Agent(已完成:登录/IMAP/探索/截图)
   ├── ② Capture 适配器 ★本项目核心新代码
   │      Firenze 产物 → 官方 capture/ 目录格式
   ├── ③ HyperFrames 编排(product-launch-video Step 2→6)
   │      跳过官方 Step1,喂入 ② 的 capture/
   └── ④ Render(本地或 Docker,FFmpeg 编码)
        ▼
   renders/video.mp4 + snapshots/contact-sheet.jpg
```

### 技术选型(已定)
| 维度 | 决策 |
|---|---|
| TTS | **本地 Kokoro**(`pip install kokoro-onnx soundfile`),离线、现场稳 |
| 渲染 | **服务器**上跑,本地 `render --quality high` 或 `render --docker` 皆可(已装 Docker) |
| 多模态 LLM | **阶跃星辰 StepFun**(与 Firenze `step-client.ts` 同源),用于:agent 决策 + 资产描述生成 + 分镜编导 |
| 前端 | PurpleInk(Next.js,已完成),无登录,输 URL 即用 |
| 引擎 | `hyperframes` npm 包(实测 0.7.68),Node 22 + Chromium + FFmpeg |
| 视频规格 | **横屏 1920×1080 / 60–120s**(用户定);→ 见 §6.1 时长影响 |

---

## 4. 管线详细步骤

| 步 | 动作 | 用什么 | 产物 |
|---|---|---|---|
| 0 | init 项目 + 写 BRIEF.md(自主模式,无人工 gate) | hyperframes CLI | `videos/<project>/`, `BRIEF.md` |
| 1 | **不跑官方 capture**;跑 Firenze agent → 适配器写 `capture/` | ①② | `capture/extracted/*`, `capture/assets/*` |
| 2 | 选设计预设 + 品牌混色 | `build-frame.mjs`(读 `tokens.json`) | `frame.md` |
| 3 | 分镜 + 旁白(StepFun 编导) | product-launch-video Step3 | `STORYBOARD.md`, `SCRIPT.md` |
| 3.1 | 旁白/字幕音频 | **Kokoro** (`--provider kokoro`) | `audio_meta.json` |
| 4 | 逐帧视觉设计 | Step4 | 富化 `STORYBOARD.md` |
| 5 | 逐帧 HTML 合成 + 装配 | Step5(sub-agent) | `compositions/frames/*.html`, `index.html` |
| 6 | check + render | CLI | `renders/video.mp4` |

---

## 5. ★核心模块:Capture 适配器规范

**输入**:Firenze agent 产物(截图 buffer + 元数据 + 语义快照)。
**输出**:与官方 `hyperframes capture` 一致的目录(已用 `https://ui.shadcn.com` 抓金样本,存于 `_capture_probe/`)。

### 必需产出(product-launch-video Step1 Gate)
```
capture/
├── assets/                    # 截图 NN-<slug>.png(+ 录屏 .mp4)
└── extracted/
    ├── tokens.json
    ├── visible-text.txt
    └── asset-descriptions.md
```

### 各文件契约(基于金样本实测)

**`tokens.json`** — 下限 `{title, description, colors[], fonts[]}`;为贴品牌建议补 `cssVariables`、`colorStats[]`(按 bgCount/textCount/maxArea 判角色)、`sections[]`。
```json
{ "title": "", "description": "", "colors": ["#..."], "fonts": [{"family":"","weights":[400]}],
  "cssVariables": {"--primary":"#..."}, "colorStats": [{"hex":"#...","bgCount":0,"textCount":0,"maxArea":0}] }
```
- 来源:Firenze snapshot 需**新增**抓取 `getComputedStyle` 主色/字体/CSS 变量(小改动)。

**`visible-text.txt`** — 逐行 `[tag] 文本`(如 `[h1] ...`)。
- 来源:Firenze `snapshot.textContent`,**含登录后各页**——这是我们比官方多的料。拼接顺序按采集步序。

**`asset-descriptions.md`** — `# Asset Descriptions` + 每资产一行 `- <path> — <描述>`。
- 来源:每张截图用 `pageType + aiDecision + label` 生成描述;**用 StepFun 多模态**对截图做视觉级描述(对齐官方设了 GEMINI key 的效果)。
- 规则(下游 Step3 只认此文件):路径写 `assets/<basename>`,视频标 `[video]`,不编文件名。

### 验证方法
适配器输出 **对拍金样本** `_capture_probe/extracted/*` 的结构;再跑一次 product-launch-video 从 Step2 起,确认 Gate 通过。

---

## 6. ★架构核心抉择:Step 2→6 怎么驱动(需你拍板)

官方 product-launch-video 是给"AI agent 逐步执行"的工作流(Step3/4/5 要 LLM 写分镜、派 sub-agent 写帧 HTML),**不是一条 CLI 命令**。后端要跑它,有两条路:

| 方案 | 做法 | 质量 | 现场风险 | 复杂度 |
|---|---|---|---|---|
| A 全保真(推荐) | 后端起一个 LLM agent,以**自主模式**跑完 Step2→6(真分镜+真逐帧动画) | 最高 | 中(耗时/偶发失败) | 高 |
| B 模板驱动 | 跳过 LLM 逐帧,用固定 HyperFrames 合成模板 + 罐头 GSAP,槽位填 capture 数据 | 中上 | 低(确定性强) | 中 |

**已定:A 为主 + B 兜底。**
- 正常走 A(自主模式、无人工 gate、限定 2–3 个风格预设)拿高质量;
- 设**硬超时**,超时或 check 失败则自动降级到 B 的模板出一版可用视频。
- 这样"质量第一"与"现场不翻车"两头都保。

### 6.1 时长影响(★重要提醒)
你选了 **60–120s**,比常见 demo 视频长很多,有两个直接后果:
- **方案 A 耗时与风险随时长线性上升**:Step5 逐帧 HTML 合成的 LLM 工作量、以及渲染帧数(120s@30fps=3600 帧)都大幅增加。硬超时需从 5–8 分钟放宽(估 **12–20 分钟**),否则会频繁降级到 B。
- **建议用"场景/章节"结构分段**:把 60–120s 拆成 5–8 个场景(每段 10–20s),逐段生成再拼接,既降单次超时风险又便于局部重试。
- **现场强建议预渲染缓存**:演示前把目标站跑一遍存好成片,现场只展示/微调。

---

## 7. 依赖与环境(服务器)

- Node 22+(已 v22.18)、Chromium(hyperframes 自带)、**FFmpeg + FFprobe(✅ 已装 Gyan.FFmpeg 8.1.2,winget 用户作用域)**
- `hyperframes@latest`(实测 0.7.68)
- **Kokoro**:`pip install kokoro-onnx soundfile`
- Firenze agent 依赖:Playwright、ImapFlow 等
- 环境变量:`STEP_API_KEY`(StepFun)、`IMAP_*`(自助注册收码)、`HF_TTS_PROVIDER=kokoro`
- Docker(已装)——可选用于 `render --docker` 复现渲染

### ✅ M1 实测结论(2026-07-24,本机验证渲染链路已通)
- 在 `m1-smoke/` 手写最小合成(shadcn 风 10s,GSAP 动画)→ `check` 全过(Lint/Runtime/Layout/Motion 0 错、对比度 10/10 AA)→ `render` 产出 **h264 / 1920×1080 / 30fps / 10.0s / 300帧**。
- **渲染速度**:10s 片耗时 **22.2s**(含启动校准);自动启用 **GPU 硬加速**(RTX 5060 / ANGLE D3D11);静态帧 dedup 复用 65% 帧。→ 对 60–120s 正片是好信号,dedup + 多 worker 大幅摊平耗时。
- **30s 真实测试片(`shadcn-30s/`)**:手驱 Step2→6,拿金样本真实文案/品牌色(Inter、纯黑白)/真实 dashboard 截图,做了 5 场景(品牌→hero→浏览器框下滚展示→价值三卡→CTA)。check 0 错、对比度 21/21 AA;render 产出 **2.8MB / 30.0s / 900帧 / 57s**。目检五帧均专业、完全对齐 shadcn 调性。→ **验证了核心假设:手驱官方管线能产高质量片,且 agent 截图能直接当主素材。
- **踩到的坑(已记)**:
  1. winget 被沙箱拦(Access denied),需提权执行;装后 PATH 需新 shell 才生效,本会话需手动前置 bin 目录。
  2. **GitHub/registry 被墙**:`init --example swiss-grid`、`skills update`、`hyperframes add`(registry blocks)都需联网拉取。代理在 **7897**。
  3. **hyperframes CLI(Node 原生 fetch/undici)不读 `HTTP_PROXY` 环境变量**(Node 22 未内建)——所以环境变量代理对 registry 无效。M3+ 用官方 registry blocks 时需:给 node 配 `global-agent`/`NODE_USE_ENV_PROXY`(Node 24+)或本地镜像 blocks。**M1–M2 不依赖 registry**,用 `--example blank` 离线即可。
  4. jsdelivr(GSAP CDN)与 Google Fonts **直连可达**,渲染时无需代理。

---

## 8. 开发里程碑

> 进度调整（已定）：**先本地跑通测试，M6 上服务器放最后**。顺序：引擎 → 适配器 → 接 Firenze → 渲染管线（方案 B）→ 后端 API → 前端 → 方案 A 兜底 → 上生产。

1. **M1 打通引擎**（✅ 完成）：装 FFmpeg，手写最小合成 → check → render → 出一版 mp4，已验证本机能渲染（见 §7 M1 实测结论）。
2. **M2 Capture 适配器**（✅ 完成）：写 Firenze 产物 → `capture/` 的适配器，对拍金样本 25/25 通过。
3. **M3 接 Firenze**（✅ 完成）：URL → agent 采集 → 适配器 → `capture/`（命令行端到端，mock 冒烟通过）。
4. **M4 封装渲染管线（方案 B）**（✅ 完成）：`server/src/compose/` 把 `capture/` → 模型 → index.html → check → render → `video.mp4`，命令行端到端验证出合法 1080p/30fps/24s mp4（见 `Agent采集设计.md` 实现进度）。
5. **后端 API + 前端接线**（进行中）：`POST /capture` + `POST /render` + 进度/产物查询，前端落地页输入 URL → 轮询 → 播放/下载。
6. **M5 质量与兜底**：方案 A 自主管线 + 超时降级 B；Kokoro 旁白；check 质检。
7. **M6 上服务器（最后做）**：装 Chromium、配 `.env`、部署、限时压测、失败兜底、预热缓存。

---

## 9. 风险与兜底

| 风险 | 兜底 |
|---|---|
| 目标站登录/验证码卡住 | Firenze 已有:IMAP 收码 / 补采公开页 / 死循环保护 |
| Step2→6 LLM 管线超时或失败 | 降级到模板方案 B 出片 |
| 渲染出黑帧/布局崩 | 保留 `hyperframes check` 质检 gate |
| 现场网络差 | TTS 用本地 Kokoro;渲染本地;仅 StepFun 需联网(可预生成) |
| StepFun 限速 | 复用 Firenze 的全局串行队列 + 节流 + 退避 |

---

## 10. 开放问题(待你确认)

✅ 已定:管线驱动 = **A+B 兜底**;测试账号 = **前端可选输入框 + IMAP 兜底**;视频 = **横屏 1080p / 60–120s**。

仍待你提供/确认:
1. **StepFun**:`STEP_API_KEY` 与模型名(Firenze 用 `step-explore`,请确认多模态视觉描述用哪个型号)。
2. **IMAP 邮箱**:`IMAP_HOST/PORT/USER/PASSWORD` + `SIGNUP_PASSWORD`(自助注册收码用)。
3. **时长取舍**(见 §6.1):确认硬超时放宽到 12–20 分钟可接受,以及是否采用分段拼接。
