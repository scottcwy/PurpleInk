# AI Provider Credentials

PurpleInk 只允许 Next 持有供应商凭据；在 Next 内部，平台托管凭据与工作区
BYOK 凭据必须严格隔离。任何边界变化都要先更新本文。

## 1. 两套进程的凭据边界

| | Next 应用 | Backend worker (`server/`) |
| --- | --- | --- |
| 进程 | `pnpm dev` / `next start` | `pnpm dev:worker` |
| 本地环境文件 | 根目录 `.env.local` | `server/.env` |
| Managed 来源 | 五个 `CVC_MANAGED_*_API_KEY` | 禁止持有 |
| BYOK 来源 | `provider_credentials` 加密表 | 禁止读取 |
| 模型、URL、协议真值 | `config/ai-catalog.yaml` 生成的 server manifest | 禁止复制；只调用 Next 网关 |
| 服务间凭据 | `PURPLEINK_ENGINE_INTERNAL_KEY` | 同一 `PURPLEINK_ENGINE_INTERNAL_KEY` |

两套进程不得共用 env loader，也不得让 Next 从 `server/.env` 读取密钥。worker
只额外读取 `PURPLEINK_AI_GATEWAY_ORIGIN`，该地址由部署者固定，用户不可提交。

## 2. Managed 凭据

`src/features/ai/managed-credentials.ts` 是 Next 内置 Managed 凭据的唯一解析器：

- `CVC_MANAGED_STEPFUN_API_KEY`
- `CVC_MANAGED_MIMO_API_KEY`
- `CVC_MANAGED_GEMINI_API_KEY`
- `CVC_MANAGED_OPENAI_API_KEY`
- `CVC_MANAGED_ANTHROPIC_API_KEY`

这些变量只允许进入 server-only 运行时。它们不得写入数据库、YAML、生成物、
客户端响应、日志、错误、截图或测试 fixture，也不得回退到旧 provider env 名称。
渠道 URL 与 `secretRef` 来自 `ai-catalog.yaml`；YAML 只保存变量名，不保存值。

部署前运行 `pnpm verify:managed-services`。该检查只输出变量名及
`configured` / `missing`，不输出值。

## 3. 工作区 BYOK

设置页允许工作区为五家内置供应商保存自己的 API Key。调用规则如下：

1. 客户端只提交 `provider`、`funding: "byok"` 和候选 `apiKey`。
2. 服务端从目录解析该供应商的固定官方 URL 与协议；客户端不能提交 URL。
3. 服务端先向官方链路验证候选 Key。
4. 验证失败返回 422，且不覆盖已有加密凭据。
5. 验证成功后才写入 `provider_credentials`，并保存 `verifiedAt`。
6. GET `/api/settings` 只返回配置状态与时间，不返回密文、Key、`secretRef`
   或内置渠道 URL。

五家 BYOK 官方入口分别由目录固定为 StepFun、MiMo、Google Gemini、OpenAI
和 Anthropic 官方域名。Anthropic BYOK 使用 Messages 协议；其余内置 BYOK
使用对应的 OpenAI-compatible 入口。

Managed 与 BYOK 是互斥资金来源：

- `managed` 只读取平台 env，不读取工作区 Key；
- `byok` 只解密当前工作区的 provider credential，不读取平台 env；
- 两者不会因鉴权失败、限流或渠道故障相互回退；
- BYOK 不扣 Managed 套餐权益，但仍受工作区并发、安全与审计约束。

## 4. 自定义 OpenAI-compatible 服务

设置页仍可登记一个工作区级 `openai-compatible` 服务。它的 API Key 使用同一
加密仓库，端点与默认模型是 `workspace_settings` 中的非秘密 profile 数据。
POST `/api/settings` 先发最小校验请求，成功后才原子保存 profile 与 credential。

这是用户主动配置的自定义服务，与五家内置 BYOK 不同：五家内置供应商禁止
自定义 URL；自定义兼容服务仅用于已有的明确工作板块，不参与 Managed 回退。

自定义 TTS / ASR profile 也遵循“先验证后保存、失败不覆盖”的合同。

## 5. 加密主密钥

`CVC_CREDENTIAL_MASTER_KEY` 仅存于未跟踪环境或 Secret Manager，必须是
32 字节 canonical base64。缺失或格式错误时禁止明文 fallback。

轮换主密钥必须先解密并用新密钥重新加密全部 `provider_credentials` 行。
直接删除旧主密钥会使现有密文不可恢复。

初始化本地密钥：

```powershell
pnpm tsx scripts/migration/provision-master-key.ts --env .env.local
```

此命令只写被 Git 忽略的 `.env.local`。

## 6. 运行与轮换

- Managed Key：在环境或 Secret Manager 中更新对应 `CVC_MANAGED_*`，重启 Next。
- BYOK Key：通过设置页或 `POST /api/settings` 更新，必须通过官方链路验证。
- 不再提供启动时把 provider env 写入工作区数据库的 bootstrap 服务。
- 生产容器启动依赖 migration 与可选 demo seed，不依赖任何凭据写库任务。

## 7. 安全不变量

1. 示例环境文件只列空变量名。
2. 客户端代码不得解析 provider credential。
3. API 不返回 Key、密文、`secretRef`、内部渠道 URL 或原始 provider 错误。
4. 用户不能把内置 BYOK 改成任意代理 URL。
5. Managed 和 BYOK 不交叉 fallback。
6. 设置写入必须先验证；验证失败返回 422 且不覆盖旧 secret。
7. 对话、日志或历史文件中出现过的 Managed Key 在生产启用前必须轮换。
