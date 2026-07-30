---
kind: configuration_system
name: PurpleInk 配置系统：双进程 .env 隔离与运行时加载
category: configuration_system
scope:
    - '**'
source_files:
    - .env.example
    - server/.env.example
    - config/tts.env.example
    - server/src/lib/load-env.ts
    - server/src/index.ts
    - next.config.ts
    - docs/configuration/credentials.md
    - AGENTS.md
---

## 1. 系统与架构概览

PurpleInk 采用**双进程、双 .env 文件隔离**的配置体系：Next.js 前端应用与独立的 `server/` 渲染 worker 各自维护独立的 `.env` 文件，两者互不交叉读取。配置加载遵循“环境变量优先 + 代码默认值”的简单模式，未引入 YAML/TOML 等外部配置文件格式。

核心设计原则（见 `docs/configuration/credentials.md`）：
- Next 进程只读根目录 `.env.local`，worker 进程只读 `server/.env`（可被仓库根 `.env.local` 覆盖同名键）
- 禁止在示例文件中包含真实密钥，所有 secret 变量必须留空
- 禁止创建携带 secret 的 `NEXT_PUBLIC_*` 变量

## 2. 关键文件与位置

**环境模板文件：**
- `.env.example` — Next 应用进程的环境变量模板（数据库、认证、邮件、AI 托管凭据等）
- `server/.env.example` — 后端 worker 的环境变量模板（StepFun、IMAP、TTS、Gemini 等）
- `config/tts.env.example` — TTS 专用配置模板

**配置加载逻辑：**
- `server/src/lib/load-env.ts` — 极简 .env 解析器，无第三方依赖
- `server/src/index.ts` — worker 启动入口，按顺序加载 `server/.env` → 仓库根 `.env.local`
- `next.config.ts` — Next 构建配置，直接读取 `process.env` 控制反向代理和构建行为

**配置文档与约束：**
- `docs/configuration/credentials.md` — 凭据管理权威文档，定义 Next/worker 边界
- `AGENTS.md §7` — Key 与 secret 的安全约束规范

## 3. 配置加载机制

### Worker 进程加载流程
```typescript
// server/src/index.ts
await loadEnv(join(SERVER_ROOT, ".env"))    // 先加载 server/.env
await loadEnv(join(REPO_ROOT, ".env.local")) // 再加载仓库根 .env.local（可覆盖）
const port = Number(process.env.PORT) || 8787
```

### load-env 实现特点
- 逐行解析 KEY=VALUE 格式
- 自动去除首尾引号（单引号或双引号）
- 跳过注释行（以 # 开头）
- **已存在的 process.env 键不会被覆盖**（保护系统环境变量优先级）

### Next 配置使用模式
Next 直接在 `next.config.ts` 中通过 `process.env` 访问配置：
- `CVC_NEXT_DIST_DIR` — 自定义构建输出目录
- `BACKEND_ORIGIN` — 后端 worker 地址（默认 http://localhost:8787）
- `NODE_ENV` — 控制生产环境的 console.log 移除策略

## 4. 配置分层与约定

### 环境变量命名约定
- **Next 进程专用**：`CVC_*` 前缀（如 `CVC_MAIL_SMTP_*`, `CVC_VERIFY_*`, `CVC_DEMO_ACCOUNT_*`）
- **Worker 进程专用**：服务名缩写前缀（如 `STEP_*`, `GEMINI_*`, `LISTENHUB_*`, `IMAP_*`）
- **公共配置**：`DATABASE_URL`, `TEST_DATABASE_URL`, `PORT` 等标准变量

### 安全约束（强制执行）
1. **密钥分离**：`.env.local` 仅保存平台托管 Key（`CVC_MANAGED_STEPFUN_API_KEY` 等），不得提交到 Git
2. **客户端隔离**：禁止 `NEXT_PUBLIC_*` 变量携带敏感信息
3. **验证优先**：设置类 API 必须先验证再保存，失败返回 422 且不覆盖已有密钥
4. **加密存储**：用户凭据通过 `CVC_CREDENTIAL_MASTER_KEY` 加密后存入数据库
5. **最小暴露**：GET `/api/settings` 不返回任何 apiKey 字段

### 配置来源优先级
- **Next 进程**：`process.env` > `.env.local` > 代码默认值
- **Worker 进程**：`process.env` > `server/.env` > 仓库根 `.env.local` > 代码默认值
- **数据库凭据**：`provider_credentials` 表（加密存储）> 环境变量

## 5. 特殊配置场景

### TTS 配置隔离
TTS 配置独立于主应用，通过 `config/tts.env.example` 和 `server/.env.example` 分别管理，测试用例 `tests/env.test.ts` 强制验证两个文件的分离性。

### 反代 Basic Auth
取证脚本通过 `CVC_VERIFY_BASIC_AUTH` 和 `CVC_VERIFY_ACCOUNT` 变量支持反向代理的 Basic Auth 认证，未设置时保持向后兼容。

### 开发工具配置
- `CVC_NEXT_DIST_DIR` — 允许 E2E 测试使用独立构建目录
- `CVC_REDEMPTION_CODE_PEPPER` — 兑换码生成器的盐值
- `BROWSER_DRIVER` — 浏览器驱动选择（playwright/mock）

## 6. 约束与限制

**明确禁止的行为：**
- 不在源码中硬编码配置值
- 不将 secret 写入数据库、客户端、日志或错误信息
- 不使用 YAML/TOML 等配置文件格式
- 不在根 `.env.example` 中列出 backend-step 变量（避免静默漂移）
- 运行时不允许 apiKey 的回退机制

**强制执行的检查：**
- `tests/env.test.ts` 验证 Next/worker 环境文件分离
- `scripts/setup/bootstrap-credentials.ts` 确保 bootstrap 过程的安全性
- `server-only-stub.js` 阻止非 server-only 代码访问敏感模块

该配置系统通过简单的环境变量机制实现了清晰的前后端分离，配合严格的安全约束和测试验证，确保了配置管理的可靠性和可维护性。