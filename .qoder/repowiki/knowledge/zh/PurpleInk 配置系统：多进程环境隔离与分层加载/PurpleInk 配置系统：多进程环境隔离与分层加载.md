---
kind: configuration_system
name: PurpleInk 配置系统：多进程环境隔离与分层加载
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
---

## 1. 系统与架构概览

PurpleInk 采用**多进程、多文件、分层加载**的配置体系，核心设计原则是「Next 应用进程」与「后端渲染 worker（server/）」严格隔离，各自维护独立的 .env 文件与变量命名空间，禁止交叉引用。

- **进程边界**：Next 应用（`pnpm dev` / `next start`）使用根目录 `.env.local`；后端 worker（`node server/src`）使用 `server/.env`。两者互不覆盖、互不可见。
- **加载顺序**：worker 启动时按 `server/.env` → 仓库根 `.env.local`（后者可覆盖同名键）的顺序注入 `process.env`。
- **TTS 独立配置**：TTS provider 配置单独放在 `config/tts.env.example`，不在根 `.env.example` 中列出，避免与 Next/worker 混淆。

## 2. 关键文件与包

| 文件 | 作用 |
|------|------|
| `.env.example` | Next 进程环境变量模板，含数据库、托管 AI 凭据、邮件 SMTP、取证脚本等 |
| `server/.env.example` | 后端 worker 环境变量模板，含 StepFun、IMAP、TTS、Gemini、SMTP 等 |
| `config/tts.env.example` | TTS provider 专用配置模板 |
| `server/src/lib/load-env.ts` | 极简 .env 解析器，手动注入 process.env（不依赖 dotenv） |
| `src/features/ai/config.ts` | AI 配置解析层，统一从 DB、env、default 三层合并 StepFun/Gemini/MiMo 配置 |
| `docs/configuration/credentials.md` | 凭据管理权威文档，定义托管 vs BYOK、bootstrap 流程、安全约束 |
| `next.config.ts` | Next 构建期配置，通过 `process.env` 控制 distDir、rewrites、console 移除等 |

## 3. 配置分层与优先级

AI Provider 配置遵循严格的三层优先级：**DB（加密凭据/路由） > env（环境变量） > code default**。

- **StepFun 配置**：`baseUrl` 可从 `STEPFUN_BASE_URL` 覆盖，模型字段（chatModel/ttsModel/asrModel/visionModel）仅支持默认值，不接受持久化写入。
- **托管凭据 vs BYOK**：内置三家服务（StepFun/MiMo/Gemini）默认走平台托管（`CVC_MANAGED_*`），workspace 可选择 BYOK 模式读取 DB 中的加密凭据，两条路径互不 fallback。
- **OpenAI-compatible 自定义端点**：endpoint 和 model 作为非敏感 profile 数据存储在 `workspace_settings.ai.openai-compatible`，apiKey 走相同的加密存储路径。

## 4. 约定与约束

### 强制约束（由代码/测试/文档明确保证）

1. **Secret 不得提交**：`.env.example` 中所有 secret 类变量值必须留空，真实值只写被 Git 忽略的 `.env.local` 或 `server/.env`（AGENTS.md §7 + `.env.example` 注释）。
2. **禁止 NEXT_PUBLIC_* 携带 secret**：根 `.env.example` 注释明确禁止。
3. **Next/worker 环境文件隔离**：`tests/env.test.ts:21-32` 强制验证根 `.env.example` 不得包含 backend-step 变量。
4. **无 apiKey 回退**：运行时不允许从 env fallback 到 apiKey，由两个 contract 测试强制执行。
5. **无 YAML 配置**：文档明确拒绝引入第四层 truth（YAML），保持 DB > env > default 三层即可。
6. **无统一 env loader**：前端/worker 存储保持分离，禁止引入共享加载器。

### 运行期约定

- `CVC_CREDENTIAL_MASTER_KEY` 缺失或格式错误时，凭据解密直接抛错，无明文 fallback。
- 未配置的 SMTP 通道会返回 503 状态码，不会静默假装已发送。
- Bootstrap 脚本在缺少必要变量时退出并打印 `written=0 skipped=N failed=0` 摘要，不覆盖现有行。
- `describe*Config()` 系列函数刻意不包含 `apiKey` 字段，GET `/api/settings` 无法泄露密钥。

## 5. 配置变更与热更新

- **Bootstrap 阶段**：`scripts/setup/bootstrap-credentials.ts` 从 env 读取凭据，调用真实 API 验证后加密存入 DB，然后清空 env 变量。
- **运行期更新**：唯一修改存储密钥的路径是 `POST /api/settings`，先 validateKey 再 save，失败返回 422 且不覆盖旧值。
- **无缓存**：每次调用重新读取 DB 和 env，确保配置即时生效。

## 6. 部署与容器化

- Docker Compose（`docker-compose.dev.yml` / `docker-compose.prod.yml`）通过环境变量注入各服务所需配置。
- 反代（Caddy）Basic Auth 凭据存放在 `deploy/reverse-proxy/secrets/` 目录，由 entrypoint.sh 处理。
- 生产环境 Next 通过 rewrites 将 `/api/engine/*` 转发到内网 `BACKEND_ORIGIN`，worker 不对外暴露。
