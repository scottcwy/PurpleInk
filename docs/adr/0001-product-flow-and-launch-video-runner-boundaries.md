# ProductFlow 与 LaunchVideoRunner 边界

> 2026-07-24 amendment：本修订取代早期 Local Ego 执行决策。Linux Playwright Capture Worker 是唯一浏览器执行器，不存在 Ego、Local Bridge 或其他浏览器自动化回退。

PurpleInk 将 ProductFlow 建模为 Product 所拥有、按不可变版本发布的业务步骤资产，Release 只固定引用一个版本。MVP 由 Linux PlaywrightCaptureWorker 在每个 attempt 的独立容器和 BrowserContext 中完成受控探索与证据采集；`product-launch-video` 随云端 LaunchVideoRunner 镜像版本化部署，只消费批准的 StoryboardVersion、BrandKitVersion 与 EvidencePackageVersion，再交给 Hyperframes 确定性渲染。

ProductFlow 合同不依赖具体浏览器进程，但生产执行拓扑固定为 Playwright-only。Capture Worker 可以读取当前 CaptureSession 的 URL、approved ProductFlowVersion 和短期凭据引用，并生成 screenshot、node clip、assertion report、sanitized DOM summary 与诊断 trace。LaunchVideoRunner 不接收浏览器凭据或用户产品 URL，只读取已批准 Evidence。两个运行单元不得共享容器、BrowserContext、service account、网络策略或 R2 写前缀。

登录、验证码和敏感确认通过一次性短期 URL handoff 到同一个 cloud BrowserContext；自动化暂停并等待用户显式 Resume。支付、发布、删除、权限变更和其他外部副作用不允许由 Worker 执行。

Release 将逐项批准的 NodeEvidence 与静态 SourceAsset 冻结为不可变 EvidencePackageVersion。浏览器行为事实只能引用 NodeEvidence；SourceAsset 不能替代 CaptureRun。LaunchVideoPlan 和 CompositionBundle 按 locale 独立版本化，同一 Bundle 可以包含 16:9 与 9:16 variants，但渲染阶段不得注入另一种语言。
