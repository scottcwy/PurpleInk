---
kind: configuration_system
name: PurpleInk 配置系统：双进程隔离的环境变量与凭据管理
category: configuration_system
scope:
    - '**'
source_files:
    - .env.example
    - server/.env.example
    - config/tts.env.example
    - server/src/lib/load-env.ts
    - src/features/ai/config.ts
    - src/features/ai/gemini-config.ts
    - src/features/ai/openai-compatible-audio-config.ts
    - docs/configuration/credentials.md
    - docs/configuration/tts.md
    - tests/env.test.ts
    - scripts/setup/bootstrap-credentials.ts
---

## 系统与架构概览

PurpleInk 采用**前后端进程隔离 + 分层配置**的配置体系，Next.js 前端应用与 server/worker 后端各自维护独立的环境变量文件，通过明确的边界文档和测试契约防止配置漂移。核心设计原则是“每个进程只读自己的配置，不共享 .env 文件”。

### 配置层次结构

1. **环境变量层**（最高优先级）：`.env.local`（Next 进程）、`server/.env`（Worker 进程）
2. **数据库加密存储层**：`provider_credentials` 表中的加密凭据
3. **代码默认值层**：各配置文件中的 `DEFAULTS` 常量

### 关键加载机制

- **Next 进程**：使用 `@next/env` 的 `loadEnvConfig(process.cwd())` 自动加载根目录 `.env.local`
- **Worker 进程**：自定义极简 loader `server/src/lib/load-env.ts`，按顺序加载 `server/.env` → 仓库根 `.env.local`（后者可覆盖同名键），不引入第三方依赖
- **脚本工具**：迁移和引导脚本直接操作 `process.env`，通过 `process.loadEnvFile()` 注入临时环境变量

## 核心文件与模块

### 环境模板文件
- `/.env.example`：Next 进程消费的环境变量模板，包含数据库、托管 AI 凭据、邮件通道等
- `/server/.env.example`：Worker 进程的独立模板，包含 StepFun、IMAP、TTS、Gemini 等专用配置
- `/config/tts.env.example`：TTS 供应商配置的独立示例文件

### 配置解析模块
- `src/features/ai/config.ts`：StepFun 配置解析，支持 `baseUrl` 环境变量覆盖
- `src/features/ai/gemini-config.ts`：Gemini 配置解析，支持 `GEMINI_BASE_URL`、`GEMINI_PRIMARY_MODEL`、`GEMINI_FAST_MODEL` 环境变量
- `src/features/ai/openai-compatible-audio-config.ts`：OpenAI 兼容 TTS/ASR 配置，包含完整的验证和保存逻辑
- `server/src/lib/load-env.ts`：Worker 进程的轻量级 .env 加载器

### 配置管理与安全
- `src/features/ai/managed-credentials.ts`：平台托管凭据解析，仅读取 `CVC_MANAGED_*` 系列环境变量
- `scripts/setup/bootstrap-credentials.ts`：凭据初始化脚本，将环境变量中的 API Key 验证后加密存入数据库
- `docs/configuration/credentials.md`：配置边界和使用规范的权威文档

## 架构约定与约束

### 进程隔离强制约束
- Next 和 Worker 进程**不得共享环境变量文件**，这是通过 `tests/env.test.ts` 中的契约测试强制执行的
- 禁止在根 `.env.example` 中包含属于 `server/.env.example` 的变量名（如 `STEP_API_KEY`、`LISTENHUB_API_KEY` 等）
- 禁止在客户端代码中访问任何敏感环境变量，所有配置读取都标记为 `'server-only'`

### 安全规范
- 所有 secret 类变量（API key、master key、口令）在示例文件中必须留空
- 真实值只能写在被 Git 忽略的文件中（`.env.local`、`server/.env`）
- 禁止携带 secret 的 `NEXT_PUBLIC_*` 变量
- 凭据主密钥 `CVC_CREDENTIAL_MASTER_KEY` 缺失或格式错误时，系统会拒绝启动

### 配置优先级规则
- 环境变量 > 数据库加密存储 > 代码默认值
- 托管服务凭据（`CVC_MANAGED_*`）优先于工作空间 BYOK 凭据
- 自定义 OpenAI-compatible 端点与内置托管服务完全隔离，不存在 fallback 关系

### 运行时行为
- 每次 API 调用都会重新读取数据库和环境变量，不使用内存缓存
- 设置变更通过 `POST /api/settings` 接口进行，先验证后保存，失败时不覆盖现有值
- 配置描述接口（如 `describeStepfunConfig`）只返回非敏感字段，绝不泄露 API Key

## 配置类型与用途

### Next 进程配置
- 数据库连接：`DATABASE_URL`、`TEST_DATABASE_URL`
- 凭据主密钥：`CVC_CREDENTIAL_MASTER_KEY`
- 托管 AI 凭据：`CVC_MANAGED_STEPFUN_API_KEY`、`CVC_MANAGED_MIMO_API_KEY`、`CVC_MANAGED_GEMINI_API_KEY`
- 模型端点覆盖：`GEMINI_BASE_URL`、`STEPFUN_BASE_URL`、`MIMO_BASE_URL` 等
- 反向代理：`BACKEND_ORIGIN`、`NEXT_PUBLIC_API_BASE`
- 邮件通道：`CVC_MAIL_SMTP_*` 系列变量

### Worker 进程配置
- StepFun 多模态 LLM：`STEP_API_KEY`、`STEP_BASE_URL`、`STEP_MODEL` 等
- IMAP 邮箱收验证码：`IMAP_HOST`、`IMAP_PORT`、`IMAP_USER`、`IMAP_PASSWORD`
- 浏览器驱动：`BROWSER_DRIVER=playwright`
- TTS 语音合成：`TTS_PROVIDER`、`LISTENHUB_API_KEY`、`LISTENHUB_TTS_ENDPOINT` 等
- Gemini 官方端点：`GEMINI_API_KEY`、`GEMINI_BASE_URL`、`GEMINI_PRIMARY_MODEL`
- 阿里云邮件推送：`SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS`

这种配置系统通过严格的进程隔离、多层次的安全保障和完善的测试契约，确保了 PurpleInk 在不同部署环境下的配置一致性和安全性。