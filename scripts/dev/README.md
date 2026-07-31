# scripts/dev

本地开发一键启动器。脚本正文全英文、UTF-8 with BOM（Windows PowerShell 5.1 读取
非 ASCII 时不会乱码），只读 `.env` / `.env.local` 判断变量是否有值，**不回显任何
secret**（AGENTS.md §7）。

## 用法

```powershell
pnpm dev:all       # 完整启动：Docker 引擎 -> Postgres -> 依赖 -> 迁移 -> web + worker
pnpm dev:status    # 只体检，不启动任何进程
pnpm dev:stop      # 停掉占用 web / worker 端口的进程（容器保留）
```

也可以直接双击 `scripts/dev/start-dev.cmd`，或带参数调用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/start-dev.ps1 -KillPort -Force -OpenBrowser
```

## 执行顺序

1. **工具链**：node ≥ 22.11、pnpm（与 `packageManager` 的 10.30.0 不一致时告警）。
2. **环境**：`.env.local` / `server/.env` 是否存在；`DATABASE_URL`、
   `CVC_CREDENTIAL_MASTER_KEY` 缺值直接失败；`GEMINI_API_KEY` 等缺值只告警。
3. **Postgres**：Docker 引擎没起就拉起 Docker Desktop 并等待，然后
   `docker compose -f docker-compose.dev.yml up -d`，等容器 healthcheck 变
   healthy，最后对 `DATABASE_URL` 的 host:port 做真实 TCP 握手。
4. **依赖**：`node_modules` 缺失或 `pnpm-lock.yaml` 更新时跑 `pnpm install`。
5. **迁移**：`pnpm db:migrate`。
6. **进程**：worker 先起（Next 反代首个请求就有上游），各占一个独立
   PowerShell 窗口，`-NoExit` 保证进程退出后窗口与日志仍在。
7. **就绪**：探 worker `/health`、web `/`，两者都在时再探同源反代
   `/api/engine/health`，验证 `next.config.ts` 的 engine 缝而不只是两个监听端口。

## 端口冲突

默认自动顺延到下一个空闲端口，并把 `BACKEND_ORIGIN` 同步成新的 worker 端口，
避免反代指向错误上游。两个 dev 进程的端口都通过 `PORT` 环境变量传入
（worker 的 `loadEnv` 不覆盖已存在的 `process.env`，Next 也直接认 `PORT`）。

| 参数 | 行为 |
| --- | --- |
| 默认 | 顺延端口，打印实际使用值 |
| `-KillPort` | 结束占用者以保留原端口（无 `-Force` 时逐个确认） |
| `-StrictPort` | 端口被占直接失败 |

## 常用开关

| 开关 | 说明 |
| --- | --- |
| `-WebPort` / `-WorkerPort` | 指定端口，默认 3000 / 8787 |
| `-SkipDocker` | 不动 Docker，只探测 `DATABASE_URL` 端点 |
| `-SkipInstall` / `-SkipMigrate` | 跳过依赖安装 / 迁移 |
| `-NoWeb` / `-NoWorker` | 只起其中一个进程（两个都给就只跑基础设施） |
| `-Log` | 子进程输出同时 tee 到 `.data/logs`（已被 gitignore） |
| `-OpenBrowser` | web 就绪后打开 `/products` |
| `-ReadyTimeoutSec` | 单个进程就绪等待上限，默认 180 |
| `-Force` | 跳过 `-KillPort` / `-Stop` 的确认提示 |

退出码：全部就绪为 0，任一应起的进程未就绪为 1，便于挂到别的自动化里。
