---
kind: configuration_system
name: PurpleInk 配置系统：环境变量分层与凭据隔离
category: configuration_system
scope:
    - '**'
source_files:
    - .env.example
    - server/.env.example
    - config/tts.env.example
    - deploy/reverse-proxy/secrets/basic_auth_credentials.example
    - next.config.ts
    - server/src/lib/load-env.ts
    - src/lib/config/paths.ts
    - src/features/ai/config.ts
    - src/features/ai/managed-credentials.ts
    - tests/env.test.ts
    - docs/configuration/credentials.md
    - docker-compose.dev.yml
---

## 1. 系统概览

PurpleInk 采用「多进程、多文件、严格隔离」的环境变量配置体系，核心设计原则是 Next.js Web 应用与后端 worker（server/）各自维护独立的 .env 文件，禁止共享 loader 或统一配置文件。配置来源按优先级组织为：数据库加密存储 > 环境变量 > 代码默认值，且敏感凭据通过主密钥加密后持久化到 Postgres 的 `provider_credentials` 表。

## 2. 关键文件与包

- **根级环境模板**：`.env.example` — 仅列出 Next 进程消费的变量，所有 secret 字段留空
- **服务端环境模板**：`server/.env.example` — 后端 worker 专用变量（二进制文件，内容不可读）
- **TTS 专用配置**：`config/tts.env.example` — TTS provider 独立配置，不在根 .env.example 中声明
- **反向代理凭据示例**：`deploy/reverse-proxy/secrets/basic_auth_credentials.example` — Caddy Basic Auth 用户名+bcrypt 哈希格式
- **Next 配置入口**：`next.config.ts` — 通过 `process.env.BACKEND_ORIGIN` 控制 /api/engine 重写规则
- **服务端 .env 加载器**：`server/src/lib/load-env.ts` — 极简实现，不依赖第三方库，按行解析并注入 process.env
- **路径配置模块**：`src/lib/config/paths.ts` — DATA_DIR 与 ARTIFACTS_DIR 通过 DATA_DIR 环境变量覆盖
- **AI 配置核心**：`src/features/ai/config.ts` — StepFun/Gemini/MiMo 配置的 env/default/source 三元视图
- **托管凭据解析**：`src/features/ai/managed-credentials.ts` — 唯一读取 `CVC_MANAGED_*` 平台 Key 的入口
- **配置契约测试**：`tests/env.test.ts` — 强制 .env.example 变量名与实际消费代码一一对齐

## 3. 架构与设计决策

### 3.1 双进程隔离
Next 应用与 server/ worker 完全分离：
- Next 侧使用根目录 `.env.local`（git 忽略），通过 `@next/env` 的 `loadEnvConfig(process.cwd())` 加载
- Worker 侧在 `server/src/index.ts` 启动时依次加载 `server/.env` 和根 `.env.local`，但两者变量命名空间互不干扰
- 文档 `docs/configuration/credentials.md` 明确规定「不得引入共享 loader 或统一 env 文件」

### 3.2 凭据分层策略
- **平台托管 Key**：`CVC_MANAGED_STEPFUN_API_KEY`、`CVC_MANAGED_MIMO_API_KEY`、`CVC_MANAGED_GEMINI_API_KEY` 直接从环境变量读取，永不写入数据库
- **BYOK（自带密钥）**：自定义 OpenAI-compatible 及 workspace 选择的 StepFun/Gemini/MiMo Key 通过 `scripts/setup/bootstrap-credentials.ts` 验证后加密存入 `provider_credentials` 表
- **主密钥保护**：`CVC_CREDENTIAL_MASTER_KEY` 必须存在且为 32 字节 canonical base64，缺失即抛错，无明文 fallback

### 3.3 配置优先级与回退
以 StepFun 为例（`src/features/ai/config.ts:110-128`）：
```typescript
const ENV_KEYS = { baseUrl: 'STEPFUN_BASE_URL', ... }
function envOrDefault(field) {
  const value = nonEmpty(process.env[ENV_KEYS[field]])
  return value ? { value, source: 'env' } : { value: DEFAULTS[field], source: 'default' }
}
```
- API Key：DB 加密存储 → 托管环境变量 → 报错（无回退）
- 模型端点：环境变量 → 代码默认值
- 其他模型字段：由服务端目录管理，不接受设置写入

### 3.4 安全约束
- 所有 secret 类变量（API key / master key / 口令）值必须在示例文件中留空
- 真实值只写在被忽略的 `.env.local`，禁止提交、禁止硬编码
- 禁止携带 secret 的 `NEXT_PUBLIC_*` 变量
- Bootstrap 脚本输出无条件脱敏，仅打印 provider name / configured / verifiedAt 摘要
- 客户端代码路径无法访问 `getGeminiConfig` / `getStepfunConfig`，所有消费者均标记 `'server-only'`

## 4. 约定与约束

### 4.1 文件命名约定
- 示例模板使用 `.env.example` 后缀，实际值使用 `.env.local`（git 忽略）
- TTS 配置独立存放于 `config/tts.env.example`，不在根 .env.example 中声明
- 反向代理凭据示例放在 `deploy/reverse-proxy/secrets/` 目录下

### 4.2 变量命名规范
- Next 侧托管服务使用 `CVC_MANAGED_*` 前缀
- 旧版 StepFun 变量名为 `STEP_API_KEY`（仅 server/.env.example），Next 侧已迁移至 `CVC_MANAGED_STEPFUN_API_KEY`
- 认证验证码 SMTP 通道使用 `CVC_MAIL_SMTP_*` 前缀，与采集 agent 的 IMAP_* 变量完全隔离

### 4.3 运行时约束
- `CVC_CREDENTIAL_MASTER_KEY` 缺失或格式错误时，credential-envelope.ts 强制抛错（第 45-63 行）
- `POST /api/settings` 更新凭据时必须先调用 `validateKey()` 验证，失败返回 422 且不覆盖现有行
- GET `/api/settings` 仅返回 `value/source` 对，绝不包含 apiKey 字段
- Next 构建产物可通过 `CVC_NEXT_DIST_DIR` 环境变量覆盖 distDir，避免并发冲突

### 4.4 测试保障
`tests/env.test.ts` 强制以下契约：
- 敏感示例变量必须存在且值为空（正则匹配 `^NAME=$`）
- Next 侧不得出现属于 server/.env.example 的变量（如 `STEP_API_KEY`、`LISTENHUB_API_KEY`）
- Web 配置不得解析 TTS 凭据（禁止 `getTtsEnv` / `tts/config` 引用）

## 5. 部署与环境编排

- **开发环境**：`docker-compose.dev.yml` 提供 Postgres 容器，端口映射 `127.0.0.1:54328:5432`
- **生产部署**：Next 通过 `next.config.ts` 的 rewrites 将 `/api/engine/*` 转发至 `BACKEND_ORIGIN`（默认 `http://localhost:8787`）
- **反向代理**：Caddy 镜像支持 Basic Auth，凭据文件格式 `<用户名> <bcrypt哈希>`，通过 `caddy hash-password` 生成
- **初始化流程**：`scripts/migration/provision-master-key.ts` 生成主密钥 → `scripts/setup/bootstrap-credentials.ts` 导入凭据 → `pnpm db:migrate` 执行迁移

该配置系统通过严格的进程隔离、分层凭据管理和自动化测试契约，确保多环境下的配置一致性与安全性，避免了常见的配置漂移和密钥泄露风险。