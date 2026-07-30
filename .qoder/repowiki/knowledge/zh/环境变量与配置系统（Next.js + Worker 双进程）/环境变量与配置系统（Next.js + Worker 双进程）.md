---
kind: configuration_system
name: 环境变量与配置系统（Next.js + Worker 双进程）
category: configuration_system
scope:
    - '**'
source_files:
    - .env.example
    - server/.env.example
    - config/tts.env.example
    - server/src/index.ts
    - server/src/lib/load-env.ts
    - next.config.ts
    - src/lib/site-config.ts
---

## 系统与架构概览

PurpleInk 采用「Next.js 前端进程 + 独立 Node 渲染 Worker」的双进程架构，配置系统围绕 `.env` 文件与环境变量展开，两个进程各自维护独立的配置文件，互不交叉。

- **Next.js 进程**：使用根目录 `.env.example` / `.env.local`，由 Next.js 内置的 `@next/env` 加载
- **Worker 进程**：使用 `server/.env.example` / `server/.env`，通过自实现的极简 `loadEnv` 函数加载
- **TTS 配置**：单独存放在 `config/tts.env.example`，供 TTS 相关模块读取

## 核心文件与位置

- **Next 进程环境模板**：`.env.example` — 列出 Next 进程直接消费的变量（数据库、AI 凭据、邮件 SMTP、反代等）
- **Worker 进程环境模板**：`server/.env.example` — 列出 worker 启动时加载的变量（StepFun、IMAP、Playwright、ListenHub TTS、Gemini、SMTP）
- **TTS 配置模板**：`config/tts.env.example` — 仅包含 TTS provider 相关变量
- **Worker 入口**：`server/src/index.ts` — 启动时按顺序加载 `server/.env` → 仓库根 `.env.local`
- **环境加载器**：`server/src/lib/load-env.ts` — 极简实现，解析 `.env` 文件并注入 `process.env`（已存在键不覆盖）
- **Next 配置**：`next.config.ts` — 通过 `process.env` 控制构建行为（distDir、rewrites、console 移除策略等）
- **站点配置**：`src/lib/site-config.ts` — 前端静态站点元数据与 feature flags（硬编码常量）

## 加载顺序与优先级

1. **Worker 启动流程**（`server/src/index.ts`）：
   - 先加载 `server/.env`
   - 再加载仓库根 `.env.local`（后者可覆盖同名键）
   - 最后读取 `process.env.PORT`（默认 8787）

2. **Next.js 进程**：
   - 由 Next.js 框架自动加载 `.env` / `.env.local`（通过 `@next/env` 的 `loadEnvConfig`）
   - 部分脚本显式调用 `loadEnvConfig(process.cwd())` 确保环境变量可用

3. **优先级规则**：
   - 后加载的文件会覆盖先加载的同名键
   - `loadEnv` 实现中明确 `if (!(k in process.env)) process.env[k] = v`，即不会覆盖已存在的进程环境变量

## 安全约束与约定

根据 `.env.example` 顶部的安全约束（引用 AGENTS.md §7）：
- **secret 类变量值必须留空**：API key、master key、口令等真实值只写在被忽略的 `.env.local` / `server/.env` 中
- **禁止提交含 secret 的文件**：`.env.local`、`server/.env` 均在 `.gitignore` 中
- **禁止携带 secret 的 `NEXT_PUBLIC_*` 变量**：前端不可暴露敏感信息
- **缺失即报错或返回 503**：如 SMTP 配置缺失时，验证码发送接口会如实返回 503，不会静默假装成功

## 配置分类与命名规范

- **CVC_ 前缀**：业务相关配置统一以 `CVC_` 开头（如 `CVC_CREDENTIAL_MASTER_KEY`、`CVC_VERIFY_ACCOUNT`、`CVC_DEMO_ACCOUNT_*`）
- **服务专用前缀**：第三方服务使用其缩写前缀（如 `GEMINI_*`、`STEPFUN_*`、`MIMO_*`、`LISTENHUB_*`、`SMTP_*`、`IMAP_*`）
- **NEXT_PUBLIC_* 前缀**：仅用于需要暴露到浏览器的非敏感配置（如 `NEXT_PUBLIC_API_BASE`）
- **端口与路径**：`PORT`（worker）、`BACKEND_ORIGIN`（Next 反向代理目标）、`CVC_NEXT_DIST_DIR`（自定义构建目录）

## Feature Flags 与运行时开关

- **前端 feature flags**：集中在 `src/lib/site-config.ts` 的 `features` 对象中（如 `smoothScroll`、`darkMode`），为编译时常量
- **编译器开关**：`next.config.ts` 中通过 `process.env.NODE_ENV` 控制生产环境是否移除 console.log（保留 error/warn）
- **浏览器驱动选择**：`BROWSER_DRIVER=playwright|mock` 控制采集阶段的浏览器驱动模式

## 部署与容器化配置

- **Docker Compose**：`docker-compose.dev.yml` / `docker-compose.prod.yml` 中通过环境变量注入配置
- **反向代理**：`deploy/reverse-proxy/Caddyfile` 配合 Basic Auth 凭据文件
- **种子脚本**：`scripts/setup/seed-owner-account.ts --from-env` 支持从 `CVC_DEMO_ACCOUNT_*` 环境变量创建演示账号

## 约束与限制

- **No framework 依赖**：Worker 端使用自实现的极简 `.env` 解析器，不引入 dotenv 等第三方库
- **分离原则**：Next 进程与 Worker 进程的配置完全隔离，不共享同一份 `.env` 文件
- **明文保护**：所有 secret 类变量在模板文件中值必须为空，强制开发者将真实值放入 git 忽略的文件
- **向后兼容**：旧版变量（如 `GEMINI_API_KEY`、`STEPFUN_API_KEY`）仍保留但标注为历史用途，新托管服务使用 `CVC_MANAGED_*` 前缀