# Agent Plan 与确定性视频编译器

`product-launch-video` 只输出受 schema 约束并引用批准证据的 `LaunchVideoPlanV1`，不得生成或执行任意 HTML、CSS 或 JavaScript。版本化 deterministic compiler 将 Plan、BrandKit、Template 与 AssetPackage 编译成不可变 Hyperframes CompositionBundle；预览和终稿只消费该 Bundle。这样保留 Agent 的导演能力，同时使渲染可审计、可复现并隔离任意代码执行。

