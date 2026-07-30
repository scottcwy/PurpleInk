---
kind: logging_system
name: 日志系统 — 极简 console 封装与构建期过滤
category: logging_system
scope:
    - '**'
source_files:
    - server/src/lib/logger.ts
    - next.config.ts
---

本仓库的日志系统极为轻量，未引入第三方日志框架，采用“最小可用”策略：

1. **服务端统一 logger 封装**：`server/src/lib/logger.ts` 提供 `logger.info / warn / error` 三个方法，内部直接调用 `console.log / console.warn / console.error`，并以 `[INFO] / [WARN] / [ERROR]` 前缀 + JSON 序列化附加数据的方式输出结构化字段。该文件注释标明是从 Firenze frameproof 原样拷贝。

2. **前端/脚本直接使用 console**：除 server 端 logger 外，其余代码（包括 Next.js 应用、scripts、tests）普遍直接使用 `console.log / console.error / console.warn` 进行输出，未见统一的客户端 logger 模块。

3. **构建期控制台过滤**：`next.config.ts` 中通过 `compiler.removeConsole` 在生产环境移除所有 `console.log`，但显式保留 `error` 和 `warn`（`exclude: ["error", "warn"]`）。配置注释明确说明：服务端错误不暴露给用户，分类后的诊断信息只经 `console.error` 落到服务端日志；若一并移除，生产环境容器日志中将无任何可归因信息。

4. **无集中式日志收集/分级/格式化**：没有 Winston、Pino、Bunyan 等日志库依赖；没有日志级别配置文件；没有按模块或请求追踪 ID 组织日志；没有外部 sink（文件、ELK、云日志服务）集成。

5. **约定性约束**：根据 `AGENTS.md` §6 的数据与 UI 真值规则，错误页只展示类别文案与 `error.digest`，禁止输出 raw assistant delta、tool 参数、prompt、credential、provider 原始错误或推理过程。这间接约束了日志不应包含敏感或调试级细节。

总结：这是一个以 `console.*` 为基础、仅对 server 端做简单封装、并通过 Next.js 构建配置在生产环境过滤 debug 输出的极简日志方案，适合当前规模与部署形态，但缺乏结构化采集、分级策略与外部聚合能力。