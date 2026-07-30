---
kind: configuration_system
name: PurpleInk 配置系统：环境变量分层与多进程配置管理
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
    - src/features/ai/config.ts
    - src/lib/site-config.ts
    - docker-compose.dev.yml
    - docker-compose.prod.yml
---

## 1. 系统概览

PurpleInk 采用**基于环境变量的配置系统**，通过 `.env` 文件、Docker 环境变量注入和运行时 `process.env` 读取实现。项目分为两个独立进程（Next.js 前端 + Node 渲染后端 worker），每个进程有独立的配置来源和加载策略。

## 2. 核心架构

### 2.1 双进程配置隔离
- **Next.js 应用**：使用根目录 `.env.example` 和 `.env.local`，通过 Next.js 内置的 `loadEnvConfig()` 加载
- **Worker 后端**：使用 `server/.env.example` 和 `server/.env`，通过自定义 `load-env.ts` 模块加载
- **TTS 配置**：独立存放在 `config/tts.env.example`，由 Worker 进程单独消费

### 2.2 配置加载优先级
Worker 启动时的加载顺序（`server/src/index.ts`）：
1. `server/.env` - 本地开发配置
2. 仓库根 `.env.local` - 可覆盖同名键值
3. Docker 环境变量 - 生产环境注入
4. 系统环境变量 - 最高优先级

### 2.3 安全约束机制
- 所有 secret 类变量（API key、master key、口令）在模板文件中必须留空
- 真实值只允许写入被 git 忽略的文件（`.env.local`、`server/.env`）
- 禁止将敏感信息写入数据库、客户端或日志
- 禁止使用 `NEXT_PUBLIC_*` 前缀传递 secret

## 3. 关键配置文件

### 3.1 环境变量模板
- `/.env.example` - Next.js 应用配置模板（101行，涵盖数据库、AI凭据、邮件等）
- `/server/.env.example` - Worker 后端配置模板（49行，包含StepFun、IMAP、TTS等）
- `/config/tts.env.example` - TTS服务专用配置（9行）

### 3.2 运行时配置
- `next.config.ts` - Next.js 构建和运行时配置，支持 `CVC_NEXT_DIST_DIR` 等环境变量
- `server/src/lib/load-env.ts` - 自定义 .env 加载器，支持注释和引号处理

### 3.3 应用内配置管理
- `src/features/ai/config.ts` - AI提供商配置解析，支持从环境变量、数据库、默认值三层获取
- `src/lib/site-config.ts` - 站点元数据和功能开关配置

## 4. 部署配置

### 4.1 Docker Compose 配置
- `docker-compose.dev.yml` - 开发环境，仅包含PostgreSQL服务
- `docker-compose.prod.yml` - 生产环境，包含反向代理、Next.js、Worker、PostgreSQL等完整栈

### 4.2 环境变量注入策略
- 开发环境：通过 `.env` 文件直接挂载
- 生产环境：通过 Docker secrets 和环境变量注入
- 数据库连接：使用服务名直连，避免端口映射暴露

## 5. 配置验证与默认值

### 5.1 必填字段校验
- 生产环境强制要求 `POSTGRES_PASSWORD`、`CVC_CREDENTIAL_MASTER_KEY` 等关键字段
- 缺失必要配置时，容器启动会失败并显示明确的错误信息
- 可选配置提供合理的默认值（如 SMTP、模型端点等）

### 5.2 配置来源优先级
- 环境变量 > 数据库存储 > 代码默认值
- AI提供商密钥优先从托管服务获取，其次从用户BYOK存储
- 模型路由配置支持按工作空间隔离

## 6. 特殊配置场景

### 6.1 调试和取证配置
- `CVC_VERIFY_BASIC_AUTH` - 反代Basic Auth凭据
- `CVC_VERIFY_ACCOUNT` - 自动化测试账号
- `CVC_NEXT_DIST_DIR` - 自定义构建目录

### 6.2 并发控制配置
- `CVC_QUEUE_RENDER_SHOT_CONCURRENCY` - 渲染任务并发数
- `CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY` - 导演阶段并发数
- 这些配置在生产环境必须显式设置，防止OOM问题

## 7. 配置最佳实践

### 7.1 开发环境
- 使用 `.env.local` 存放本地开发配置
- 保持 `.env.example` 为最新配置模板
- 定期同步两个环境的配置差异

### 7.2 生产环境
- 通过 Docker secrets 管理敏感配置
- 使用环境变量覆盖默认值
- 实施最小权限原则，按需注入配置

### 7.3 配置迁移
- 新增配置项时同时更新所有 `.env.example` 文件
- 提供向后兼容的默认值
- 记录配置变更对现有部署的影响

该配置系统通过严格的环境变量管理和安全约束，确保了应用在开发和生产环境中的一致性和安全性。