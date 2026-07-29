---
kind: logging_system
name: 日志系统 — 基于 console 的轻量结构化输出与构建期过滤
category: logging_system
scope:
    - '**'
source_files:
    - server/src/lib/logger.ts
    - next.config.ts
---

## 1. 使用的系统与方案
- 后端（独立渲染 Worker，`server/`）使用一个极简的 `logger` 模块，直接封装 `console.log / console.warn / console.error`，以 `[INFO] / [WARN] / [ERROR]` 前缀 + JSON 序列化附加字段的方式输出结构化日志。
- 前端（Next.js App Router）未引入额外日志框架，生产构建通过 Next.js 编译器配置移除 `console.log`，仅保留 `error` 和 `warn`，确保服务端错误信息能落到容器日志中。
- 脚本与工具（`scripts/` 下的迁移、e2e、setup 等）统一使用原生 `console.log` / `console.error` 进行调试与进度输出。

## 2. 核心文件与位置
- `server/src/lib/logger.ts`：唯一的服务端日志门面，导出 `{ info, error, warn }` 三个方法，参数为 `(event: string, data?: Record<string, unknown>)`。
- `next.config.ts`：通过 `compiler.removeConsole` 在生产环境排除 `error` / `warn`，实现构建期对 `console.log` 的剔除。
- `scripts/**/*`：各类 CLI 脚本直接使用 `console.log` / `console.error` 输出。

## 3. 架构与约定
- **单点门面**：所有服务端业务代码应通过 `server/src/lib/logger.ts` 的 `logger.info / logger.error / logger.warn` 输出，避免散落 `console.*` 调用。
- **结构化字段**：第二个参数 `data` 会被 `JSON.stringify` 后追加到同一行，便于下游日志聚合平台按字段检索。
- **级别策略**：
  - `info` → `console.log`（开发时可见，生产构建被移除）
  - `warn` → `console.warn`（生产构建保留）
  - `error` → `console.error`（生产构建保留）
- **前后端边界**：前端不依赖该 logger，而是通过 Next.js 反向代理 `/api/engine/*` 将请求转发到 `server/`；服务端的诊断信息经 `console.error` 落入容器标准输出。

## 4. 约定与约束
- **生产构建移除 debug 日志**：`next.config.ts` 明确设置 `removeConsole.exclude = ["error", "warn"]`，保证生产包体积并防止敏感信息泄露；注释强调“若一并移除，生产环境节点 failed 时容器日志里将没有任何可归因信息”。
- **事件名作为第一参数**：`logger` 要求第一个参数是描述性事件字符串（如 `[director] 模型调用失败`），便于在大量日志中快速定位来源。
- **可选结构化数据**：第二个参数必须是纯对象，会被序列化为 JSON；非对象或循环引用不会被特殊处理。
- **无异步写入与缓冲**：当前实现直接调用 `console.*`，没有队列、采样、分级开关或外部 sink（如文件、HTTP、ELK），属于轻量级本地输出。
- **脚本层未统一**：`scripts/` 目录中的工具脚本未使用 `logger`，而是直接 `console.log` / `console.error`，属于一次性或测试用途的约定。