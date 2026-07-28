---
kind: configuration_system
name: PurpleInk 配置系统：双进程隔离的环境变量与数据库加密凭据体系
category: configuration_system
scope:
    - '**'
source_files:
    - server/src/lib/load-env.ts
    - src/features/ai/config.ts
    - docs/configuration/credentials.md
    - docs/configuration/tts.md
    - next.config.ts
    - .env.example
    - server/.env.example
    - config/tts.env.example
---

## 系统概述

PurpleInk 采用**双进程隔离 + 分层解析**的配置架构：Next.js 前端应用与独立的 Node 渲染后端（server/）各自维护独立的环境变量文件，AI 提供商密钥通过一次性 bootstrap 流程写入 Postgres 加密存储，运行时仅从数据库读取，禁止明文 env 回退。

## 核心机制

### 1. 环境变量加载策略
- **Next 进程**：使用 `@next/env` 的 `loadEnvConfig(process.cwd())` 加载根目录 `.env.local`，由 Next 构建时自动处理 `.env` / `.env.local` / `.env.production`
- **Server worker**：自定义极简 loader `server/src/lib/load-env.ts`，按顺序加载 `server/.env` → 仓库根 `.env.local`（后者覆盖同名键），不引入第三方依赖
- **TTS 配置**：独立模板文件 `config/tts.env.example`，与 server/.env 对齐但不混入根 .env.example

### 2. 凭据分层解析（优先级从高到低）
- **Next 侧 AI 配置**：`DB 加密存储 (provider_credentials)` → `环境变量 (BASE_URL/MODEL)` → `代码默认值`。API key 字段**禁止** env 回退，仅支持 baseUrl 和 model 字段的环境覆盖
- **Server worker**：`环境变量` → `代码默认值`，worker 启动时直接读取 process.env
- **配置文件来源标注**：每个配置项附带 `source: 'settings' | 'env' | 'default'` 标记，便于调试追踪

### 3. 安全约束与边界
- **密钥隔离**：Next 侧使用 `GEMINI_API_KEY` / `STEPFUN_API_KEY`，worker 侧使用 `GEMINI_API_KEY` / `STEP_API_KEY`，命名差异是有意隔离而非疏漏
- **master key 管理**：`CVC_CREDENTIAL_MASTER_KEY`（32 字节 base64）缺失即抛错，无明文 fallback
- **bootstrap 流程**：`scripts/setup/bootstrap-credentials.ts` 验证真实 API 后写入加密存储，运行结束后 env 变量不再被消费
- **设置页更新**：POST `/api/settings` 先验证再保存，GET 端点绝不返回 apiKey

### 4. 配置类型与范围
- **Next 专用**：`DATABASE_URL`、`TEST_DATABASE_URL`、`BACKEND_ORIGIN`、`NEXT_PUBLIC_API_BASE`、`CVC_MAIL_SMTP_*`、`CVC_VERIFY_*`、`CVC_DEMO_ACCOUNT_*`
- **Worker 专用**：`STEP_API_KEY`、`IMAP_*`、`BROWSER_DRIVER`、`LISTENHUB_*`、`SMTP_*`
- **共享但隔离**：`GEMINI_API_KEY`（两侧同名但值独立）、`*_BASE_URL` / `*_MODEL`（可环境覆盖的非敏感配置）

## 关键文件

- `server/src/lib/load-env.ts` — 极简 .env 解析器，支持引号包裹值，已存在键不覆盖
- `src/features/ai/config.ts` — StepFun 配置解析，包含 DEFAULTS、ENV_KEYS 映射和 configuredModel 优先级逻辑
- `docs/configuration/credentials.md` — 权威文档，定义双存储边界、冷启动流程和所有安全不变量
- `docs/configuration/tts.md` — TTS/ASR 配置规范，涵盖 MiMo、StepFun、OpenAI 兼容端点的协议细节
- `next.config.ts` — Next 构建配置，通过 `process.env.BACKEND_ORIGIN` 控制反向代理目标
- `.env.example` / `server/.env.example` / `config/tts.env.example` — 三类环境模板，值必须留空

## 设计原则

1. **进程隔离**：Never share, never cross-load，两个进程树完全独立
2. **DB-only 密钥**：Next 侧 API key 只存加密内容，不得明文 fallback
3. **显式覆盖**：非敏感配置（baseUrl/model）可通过环境变量覆盖，敏感配置必须通过设置页或 bootstrap
4. **零信任默认**：缺失 master key 即失败，不静默降级
5. **可追溯性**：每个配置项标注 source，便于诊断配置来源