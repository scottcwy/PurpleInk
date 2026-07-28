---
kind: configuration_system
name: PurpleInk 配置系统：双进程隔离的环境变量与加密凭据管理
category: configuration_system
scope:
    - '**'
source_files:
    - .env.example
    - server/.env.example
    - config/tts.env.example
    - server/src/lib/load-env.ts
    - src/features/ai/config.ts
    - docs/configuration/credentials.md
    - next.config.ts
    - drizzle.config.ts
    - docker-compose.dev.yml
---

## 1. 系统概览

PurpleInk 采用**双进程隔离 + 分层加载**的配置体系：Next.js 应用进程与独立 Node 渲染 worker（server/）各自维护独立的 `.env` 文件，绝不共享、绝不交叉加载。运行时配置遵循 `DB > env > code default` 的优先级顺序，敏感凭据通过 Postgres 加密存储，非敏感端点/模型配置可通过环境变量覆盖。

## 2. 核心文件与包

- **根环境模板**：`.env.example` — Next 进程消费的环境变量清单（数据库、AI 提供商、邮件 SMTP、反代等）
- **Worker 环境模板**：`server/.env.example` — 后端 worker 专用（StepFun、IMAP、TTS、Gemini、SMTP）
- **TTS 专用模板**：`config/tts.env.example` — TTS 提供商独立配置
- **配置文件**：`next.config.ts`（Next 构建与重写）、`drizzle.config.ts`（数据库迁移）
- **环境加载器**：`server/src/lib/load-env.ts` — 极简 .env 解析器（无第三方依赖）
- **凭据文档**：`docs/configuration/credentials.md` — 权威配置边界与冷启动流程说明
- **AI 配置模块**：`src/features/ai/config.ts`、`src/features/ai/gemini-config.ts` 等

## 3. 架构与设计决策

### 3.1 双进程隔离
| 维度 | Next 应用进程 | Backend worker (server/) |
|------|---------------|--------------------------|
| 进程 | `pnpm dev`, `next start` | `pnpm dev:worker`, `node server/src` |
| 密钥文件 | `./.env.local` | `./server/.env` |
| 变量命名 | `GEMINI_API_KEY`, `STEPFUN_API_KEY` | `GEMINI_API_KEY`, `STEP_API_KEY` |
| 运行时解析 | DB 加密存储（无 env 兜底） | env → code default |
| Bootstrap 写入 | `scripts/setup/bootstrap-credentials.ts` | 无（直接读取 env） |

### 3.2 配置优先级层次
- **Next 侧**：`DB 加密存储（provider_credentials）→ 环境变量（仅 *_BASE_URL/*_MODEL）→ 代码默认值`
- **Worker 侧**：`环境变量 → 代码默认值`
- 每个请求都重新读取 DB 和 env，无缓存层

### 3.3 凭据安全机制
- API Key 在 Next 侧**仅从 DB 读取**，禁止明文 env fallback
- 使用 `CVC_CREDENTIAL_MASTER_KEY`（32 字节 base64）对凭据进行加密存储
- 冷启动通过 `bootstrap-credentials.ts` 验证并写入加密凭据后清空 env 中的密钥
- 所有 `apiKey` 字段在 describe API 中故意不返回，防止泄露

## 4. 约定与约束

### 4.1 强制约束（由测试和文档明确保证）
- **AGENTS.md §7**：secret 类变量值必须留空，真实值只写被忽略的 `.env.local`，禁止提交或硬编码
- **禁止 NEXT_PUBLIC_* 携带 secret**：前端不会暴露任何敏感信息到浏览器
- **No env fallback for apiKey**：`config.test.ts:119` 和 `gemini-config.test.ts:93` 锁死此行为
- **分离的 env 文件**：`tests/env.test.ts:21-32` 确保 root `.env.example` 不包含 backend 变量

### 4.2 运行约定
- Worker 启动时按顺序加载：`server/.env` → 仓库根 `.env.local`（后者可覆盖同名键）
- 数据库连接通过 `DATABASE_URL` / `TEST_DATABASE_URL` 区分开发/测试环境
- Next 反向代理通过 `BACKEND_ORIGIN` 环境变量指向 worker（默认 `http://localhost:8787`）
- 生产构建移除 `console.log` 但保留 `error/warn`，便于诊断

### 4.3 配置更新路径
- 首次冷启动：`provision-master-key.ts` → `db:migrate` → 手动复制密钥 → `bootstrap-credentials.ts`
- 运行时更新：仅通过 `POST /api/settings` 接口，先验证再加密保存
- 模型/端点覆盖：通过 `*_BASE_URL` / `*_MODEL` 环境变量实现热重载

## 5. 工具链集成
- Docker Compose 管理 PostgreSQL 服务（`docker-compose.dev.yml`）
- Drizzle Kit 管理数据库迁移（`drizzle.config.ts`）
- Next.js rewrites 将 `/api/engine/*` 转发到后端 worker
- 脚本工具链：`scripts/setup/`、`scripts/migration/`、`scripts/verify/` 分别处理初始化、迁移和验证

该配置系统通过严格的进程隔离、加密存储和明确的优先级规则，在保证安全性的同时提供了灵活的运行时配置能力。