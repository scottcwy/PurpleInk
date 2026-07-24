---
format: 1920x1080
duration: 30s
message: "阶跃星辰让开发者从一行调用构建真实可执行的 Agent，把每个人的可能放大十倍"
arc: Future Pacing + Feature-to-Benefit
audience: AI 开发者与产品团队
mode: autonomous
language: zh-CN
music: none
captions: on
---

## Video direction

- palette system: 全片使用 `frame.md` 的明亮白色画布；近黑承担主标题，`#50B0F0` 只承担主强调、连接线与进度状态，`#50C0C0` 只承担次级文字。官网青绿玻璃晶体保留素材原色，不再添加第二套人工渐变。
- motion grammar: 所有进入与重排使用平滑长尾收束（默认 `power3`），严格跟随旁白逐项揭示，重点内容延后到每帧后半段；只使用有限、可 seek 的 GSAP 动作，静止读图优先于装饰性运动。
- reveal model: t=0 只出现旁白正在说的第一个信息；后续文字、模块、连接和产品证据只在对应词被念到时出现。每帧最后一次揭示后稳定停住，字幕区域下方约 17% 始终留空。
- rhythm and holds: Frame 1 在问号落下后短暂停顿；Frame 3 在左右证据完成后作为中段证明帧稳定持有；Frame 4 是全片最活跃的机器工作段；Frame 5 的品牌锁定与网址持有全片最长。
- negative list: 不出现深色霓虹、紫蓝 AI 渐变、粒子场、漂浮光斑、浏览器外壳或真实鼠标；不做弹跳式默认缓动、卡片呼吸、后半段慢推镜头、各元素独立漂浮；禁止先在前 25% 全部入场再冻结的 slideshow，也禁止全画布持续乱动的 screensaver。

## Frame 1 — 一个想法

- scene: 官网 Hero 晶体从单个模块显形，标题从“一个想法”推进到“能走多远？”
- voiceover: "一个想法，能走多远？"
- duration: 4s
- poster: 3s
- transition_in: cut
- status: animated
- src: compositions/frames/01-one-idea.html
- type: hook
- persuasion: Future pacing
- beat: curiosity
- blueprint: kinetic-type-beats (Adapt) — 保留短语逐拍替换的标志动作，以官网 Hero 晶体替代纯色背景；文字仍是镜头节奏主体
- asset_candidates: assets/hero-bg-D26GR-1t.mp4 — 官网青绿玻璃方块 Hero 视频
- focal: assets/hero-bg-D26GR-1t.mp4
- roles: hero-bg-D26GR-1t.mp4 = background（全幅、保持原色与清晰晶体轮廓）
- sfx: whoosh-short, impact-bass-1

narrativeRole: 用结果语言打开想象空间，不从模型参数或功能列表起步。
keyMessage: 一个普通想法可以被放大成真正工作的产品。

Adapt: 保留中心短语逐拍替换和最终问号锁定；把纯色场改为真实 Hero 视频，并让晶体运动承担第二视觉焦点。
Scene 1 (0.0–1.25s): Hero 视频全幅铺底，晶体从画面深处显形；“一个想法”在上方三分之一处以逐词揭示进入（`dynamic-content-sequencing`），文字与晶体形成 layered-depth，主视觉覆盖画面约 65%，下方字幕带保持干净。
Scene 2 (1.25–2.75s): 当旁白转到“能走多远”，前一句在原位硬切为“能走多远”（`discrete-text-sequence`），问句字号放大成为第一焦点；晶体只保留素材自身运动，镜头锁定，不附加后半段推拉。
Scene 3 (2.75–4.0s): 问号与一条青蓝细线在读音落点同步锁定，使用一次克制的关键词亮起（`asr-keyword-glow`）；画面稳定持有，最多只保留素材内生运动。

## Frame 2 — 从一行调用开始

- scene: 一个透明方块分解为模型、API、Studio 三个模块，再围合成 StepFun 品牌锁定
- voiceover: "在阶跃星辰，它从一行调用，走向一个真正工作的 Agent。"
- duration: 5s
- poster: 4s
- transition_in: zoom-through 0.45s
- status: animated
- src: compositions/frames/02-one-call.html
- type: product_intro
- persuasion: Mechanism made tangible
- beat: clarity + possibility
- blueprint: logo-assemble-lockup (Adapt) — 保留模块向中心组装并锁定官方 Logo 的标志动作，把抽象 Logo 零件改为 StepFun 产品晶体与能力标签
- asset_candidates: assets/platform-cta-crystal-btq-eknp.png — 开放平台冰蓝晶体; assets/studio-crystal-d1fgegvt.png — Studio 晶体; assets/logo-e1eaeba0.svg — StepFun 官方横版 Logo
- focal: assets/logo-e1eaeba0.svg
- roles: platform-cta-crystal-btq-eknp.png = supporting（Step API 模块）; studio-crystal-d1fgegvt.png = supporting（Studio 模块）; logo-e1eaeba0.svg = cutout（最终品牌锁定）
- sfx: whoosh, chime

narrativeRole: 在第二个节拍交付核心承诺，把“十倍可能”落实到从调用到 Agent 的路径。
keyMessage: StepFun 不是单一模型，而是一条把调用变成执行的构建路径。

Adapt: 保留“散件汇聚成品牌锁定”的 signature move；晶体与能力标签是散件，官方 Logo 是不可重绘的最终锁定。
Scene 1 (0.0–1.15s): 白色画布中央只出现一个“1 行调用”代码胶囊与开放平台晶体，二者从同一中心平滑落位（`spring-pop-entrance` 的无过冲长尾版本）；Centered，晶体约占画面高度 45%，标题位于上方安全区。
Scene 2 (1.15–2.75s): 随“走向”展开，平台晶体、Studio 晶体和“模型 / API / Studio”三枚标签从中心簇向外同步展开（`center-outward-expansion`）；asymmetric 60/40、三层深度，标签按旁白节拍依次清晰，不同时抢入。
Scene 3 (2.75–4.2s): 模块沿原路径向中心回收并在 Logo 后方压平，官方 Logo 从模块交汇处完整显现；使用 assemble-and-flatten（`depth-scatter-assemble`）保留组装动作，Logo 本体不拆字、不重绘。
Scene 4 (4.2–5.0s): “真正工作的 Agent”在 Logo 下方逐词揭示（`dynamic-content-sequencing`），Logo 与承诺形成 centered lockup；全画面停止重排并清晰持有。

## Frame 3 — 看见、思考、执行

- scene: Step 3.7 Flash 真实产品卡成为主画面，三段能力在左右两侧依次落位
- voiceover: "Step 3.7 Flash，看得见，想得清，做得到。"
- duration: 6s
- poster: 4.5s
- transition_in: crossfade 0.4s
- status: animated
- src: compositions/frames/03-step-37-flash.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: confidence
- blueprint: comparison-split (Adapt) — 保留左右镜像开书式双卡；左卡承载“看得见 + 想得清”，右卡承载“做得到”，避免三张同质卡破坏平衡
- asset_candidates: assets/step-37-flash.png — Step 3.7 Flash 官网产品卡与玻璃方块
- focal: assets/step-37-flash.png
- roles: step-37-flash.png = cutout（同一真实产品卡在左右两块证据窗口中做互补裁切）
- sfx: whoosh-short, click-soft

narrativeRole: 用官网最新主推模型证明“真正工作的 Agent”不是抽象口号。
keyMessage: Step 3.7 Flash 同时理解视觉信息、完成推理并稳定执行。

Adapt: 保留两张等权卡从两翼以镜像 `rotateY` 打开的 signature move；将三个口播词归为“理解”和“执行”两组，真实 Step 3.7 Flash 产品卡贯穿两侧。
Scene 1 (0.0–1.2s): “Step 3.7 Flash”标题从上方短距离落入（`gsap-effects`，长尾收束），官网产品卡在中央作为低对比底层预告；Centered T 形构图，标题为第一焦点。
Scene 2 (1.2–3.35s): 左右两块等宽证据卡从相反两翼进入并形成镜像开书倾角（`split-tilt-cards`）；左卡使用产品卡的视觉与推理区域，右卡使用执行结果区域，split-screen 对称但保留三层景深。
Scene 3 (3.35–4.75s): “看得见 · 想得清”内侧胶囊先落在左卡，再在“做得到”读音处让右卡胶囊落位（`spring-pop-entrance`，仅胶囊允许极轻微过冲）；两次落点错开，形成从理解到执行的视线移动。
Scene 4 (4.75–6.0s): 两卡恢复更平的阅读角度并保持静止，产品名、两组能力与真实产品图同时可读；不做双卡呼吸，只让青蓝连接线完成一次有限亮起后停住。

## Frame 4 — API 到 Agent

- scene: Step API 模块点亮后，模型、工具与工作流依次连接，最终展开真实阶跃 AI 产品界面
- voiceover: "稳定、高性能、易集成的 Step API，连接模型、工具与工作流，让下一个 AI 应用更快落地。"
- duration: 8s
- poster: 6.5s
- transition_in: push-slide LEFT 0.45s
- status: animated
- src: compositions/frames/04-api-to-agent.html
- type: feature_showcase
- persuasion: Feature-to-benefit translation
- beat: control + momentum
- blueprint: agent-progress-theater (Adapt) — 保留单次触发、机器工作状态与结果回执三段式，把检查清单替换为“模型 → 工具 → 工作流”的真实构建路径
- asset_candidates: assets/platform-cta-crystal-btq-eknp.png — Step API 开放平台晶体; assets/studio-crystal-d1fgegvt.png — Studio 晶体; assets/product-cn-xhvucdg.webp — 阶跃 AI 桌面与移动端真实产品界面
- focal: assets/product-cn-xhvucdg.webp
- roles: platform-cta-crystal-btq-eknp.png = supporting（Step API 触发源）; studio-crystal-d1fgegvt.png = supporting（Agent 工作状态）; product-cn-xhvucdg.webp = cutout（完成后的真实产品回执）
- sfx: click-soft, ping, chime

narrativeRole: 把“易集成”翻译成开发者真正关心的结果：更快完成可运行的 AI 应用。
keyMessage: Step API 把模型、工具与工作流连成一次可交付的执行。

Adapt: 保留 agent-progress-theater 的 trigger → working state → receipt signature；没有虚构输入框或多步点击，触发后由机器自己完成连接，最终以真实产品界面作为回执。
Scene 1 (0.0–1.25s): 左侧 40% 只出现开放平台晶体与“Step API”标签，一次青蓝脉冲沿晶体边缘点亮作为触发（`ambient-glow-bloom` 单次通过）；asymmetric 40/60，右侧预留工作区，字幕带以上排布。
Scene 2 (1.25–3.55s): 随“稳定、高性能、易集成”依次出现三枚状态标签，中心状态从“连接模型”切换到“调用工具”再到“编排工作流”（`discrete-text-sequence`）；连接线以 SVG 自绘从左向右延伸（`svg-path-draw`），Studio 晶体在终点显现，机器工作是唯一持续动作。
Scene 3 (3.55–5.9s): 三个步骤逐项由轮廓状态切换为青蓝完成标记，标签同时变为“已连接”（`scale-swap-transition` + `svg-path-draw`）；每项只在旁白提到对应对象后完成，形成可见的状态 mutation。
Scene 4 (5.9–7.15s): 完成标记收束为一张“Agent ready”回执条，真实阶跃 AI 桌面与移动端界面从回执下方展开并成为主视觉（`anchored-layout-expand` + `scale-swap-transition`）；产品界面占画面约 58%，不加浏览器外壳。
Scene 5 (7.15–8.0s): “更快落地”在产品界面上方稳健落位，青蓝进度线填满后停止（`stat-bars-and-fills`，不显示虚构百分比）；镜头锁定，让真实产品证据持有至转场。

## Frame 5 — 十倍可能

- scene: 前四帧的晶体模块从四周归位，官方 Logo 与官网地址在白色画布中央完成锁定
- voiceover: "从 Coding 到 Agent，皆可构建。阶跃星辰，智能阶跃，十倍每个人的可能。"
- duration: 7s
- poster: 5.5s
- transition_in: squeeze 0.4s
- status: animated
- src: compositions/frames/05-ten-x.html
- type: cta
- persuasion: Value stacking + brand recall
- beat: aspiration + motivation
- blueprint: logo-assemble-lockup (Adapt) — 保留前序模块回收、官方 Logo 形成与网址长持有的品牌结尾结构
- asset_candidates: assets/logo-e1eaeba0.svg — StepFun 官方横版 Logo; assets/mobile-studio-crystal-k99o-jwr.png — 青绿与冰蓝晶体组合
- focal: assets/logo-e1eaeba0.svg
- roles: logo-e1eaeba0.svg = cutout（最终官方品牌锁定）; mobile-studio-crystal-k99o-jwr.png = supporting（从 Coding 到 Agent 的模块集合）
- sfx: riser, chime

narrativeRole: 回收品牌主线，让观众记住 StepFun、构建路径与“十倍可能”。
keyMessage: 现在就从 StepFun 开始构建下一个 AI 应用。

Adapt: 保留 hand-off line → parts arrive → centered lockup → URL hold 的 signature；前四帧语言被压缩成晶体模块，官方 Logo 始终以原始 SVG 完整呈现。
Scene 1 (0.0–1.65s): “从 Coding 到 Agent”作为 hand-off line 出现在上方三分之一，青绿与冰蓝晶体组合从下方进入并在中央稳定（`spring-pop-entrance` 的长尾版本）；Centered，晶体是第二焦点。
Scene 2 (1.65–3.15s): 随“皆可构建”，晶体周围的模块标签从四周向中心汇聚并压平为一块透明积木轮廓（`center-outward-expansion` 反向 + `depth-scatter-assemble`）；“一块积木”只在完成点出现，不提前展示。
Scene 3 (3.15–5.05s): 积木轮廓后退成为背景，官方 Logo 从中心完整显现，使命句“智能阶跃 · 十倍每个人的可能”逐段加入（`dynamic-content-sequencing`）；Logo、使命句和晶体形成 centered lockup，保持白底与单一青蓝强调。
Scene 4 (5.05–7.0s): `stepfun.com` 胶囊与“开始构建”CTA 在 Logo 下方完成一次左到右揭示，青蓝细线停在网址末端；最终锁定静止持有约 2 秒，不呼吸、不漂移，作为全片最长读图。
