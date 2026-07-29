# 项目工作流来源与版本规范

本文是项目来源类型、版本兼容、执行边界、计费、Artifact 与容灾的唯一真值。
它补充 `routing.md`，不替代 Director / 渲染故障规范。

## 1. 来源类型

`projects.workflow_kind` 只允许以下稳定值：

| kind | 用户输入 | 目标工作流 | 当前接线 |
| --- | --- | --- | --- |
| `script` | 文稿 | 既有文稿 → 配音 → 分镜 → 渲染链路 | `wired` |
| `audio` | 用户录音 | ASR → 原音频时间轴 → 复用文稿分镜与渲染，不重复 TTS | 项目创建 `wired`；执行 `planned` |
| `website` | 可访问 URL | Playwright 取证 → 网站介绍编排 → 复用成熟生视频系统 | 项目创建 `wired`；执行 `planned` |

`workflow_kind` 表达来源与编排族；`workflow_version` 表达该族当前可执行的精确合同。
二者必须成对判断，禁止只比较版本字符串，也禁止由节点形状反推来源。

## 2. 活跃版本注册表

代码唯一注册表是 `src/lib/workflow/project-workflow-registry.ts`。

| kind | active workflowVersion |
| --- | --- |
| `script` | `cvc-v3-foundation|cvc-arch-v3.0.0|fabricate-landscape-1920x1080-v1|landscape-render-1920x1080-v1|node22-playwright1.61.1-ffmpeg-static5.3.0` |
| `audio` | `purpleink-audio-to-video-v1` |
| `website` | `purpleink-website-intro-video-v1` |

`script` 必须精确保留既有 `ACTIVE_WORKFLOW_VERSION` 序列化结果。audio / website 的
版本键已经稳定登记，但不代表执行器已接线。任一族修改节点合同、持久化 Artifact
结构或恢复语义时，只提升该族版本，不连带修改其他族。

列表只显示 `(workflow_kind, workflow_version)` 与注册表活跃项精确匹配的项目。
详情路由同样按项目行自己的 kind 判断；不匹配的数据标记为 legacy 并保留，不迁移、
覆盖或删除。

## 3. 创建与启动边界

- `POST /api/projects` 按 `kind` 判别联合输入，并兼容既有未携带 `kind` 的文稿 JSON。
- audio 只接受服务端测量后的 MP3/WAV multipart，客户端不得注入对象键、时长、
  采样率或 Artifact ID；website URL 在入库前规范化，最终 SSRF/DNS 守卫仍由 worker 执行。
- 创建响应直接返回事务内生成的 `entryNodeId`；`ingestNodeId` 仅是旧文稿客户端的
  过渡别名，禁止再通过创建后的图查询猜测入口。
- `POST /api/projects/[id]/start` 是计划中的统一启动入口，按已持久化 kind 分派。
- 创建只负责项目与初始拓扑的原子持久化；启动负责建立真实 run / attempt。
- 营销首页 URL 提交完成接线后必须先创建 `website` 项目，再调用统一启动入口，
  不得继续作为脱离项目账本的下载旁路。

## 4. 复用与主工作流保护

- `script` 拓扑、Director、渲染和 Artifact 合同是基线；新增来源不得推倒或暗改它。
- `audio` 在 ASR 后复用文稿分镜与渲染能力，但保留原音频作为时间与旁白真值，
  禁止再次 TTS。
- `website` 以适配器挂载成熟 worker；阶段投影可以新增，成熟生成内部不得重写。
- 共享能力从公开领域出口复用；禁止第二套账号、额度、项目状态或应用壳。

## 5. 计费与会员

三类项目共享当前 workspace entitlement、会员档位与 `usage_periods` 总额度。
新增工作流不得提高或复制套餐总额。每次托管调用必须绑定真实 run / attempt，
采用现有预留、结算、失败补偿与幂等语义；BYOK 仍按既有资金来源规则执行。

audio 的执行计费尚未接线。website 已登记为 `purpleink-engine / website-video-v1 /
workflow` 复合服务，v1 费率为每个向上取整的视频秒 `120000 CNY micros`（¥0.12）；
只有执行适配器真正预留并结算后才能展示扣费。三类来源继续共用同一 `usage_periods`
额度，不增加套餐总额。网站成熟 worker 内部调用不能把原始凭据、prompt 或供应商错误
暴露到项目 UI。

## 6. Artifact 真值

- 所有 Artifact 必须来自实际最终字节，记录真实 SHA-256、大小、版本与 attempt。
- audio 至少保留源录音、ASR 文稿、时间对齐与最终视频 lineage。
- website 至少保留安全的采集证据投影、编排结果与最终视频 lineage。
- approved / released Artifact 不可原地更新或删除；重试产生新版本并保留谱系。
- UI 只展示安全投影，不展示 raw worker 日志、credential、prompt 或隐藏推理。

## 7. 容灾与降级

每个新增执行器必须具备：队列 lease、有限重试、幂等键、可恢复检查点、用户可理解的
失败投影，以及明确的跳过/降级边界。website 需持久化 worker job 身份并处理 worker
重启后的查无任务；audio 需区分上传损坏、ASR 失败与时间对齐失败。

降级不能伪造外部网站采集或媒体产物。模板回退、缓存命中和 Playwright 备用路径都
必须作为可追溯的安全状态展示。诊断与验收继续遵循
`docs/conventions/workflow-failure-patterns.md`。
