// Purple Ink 后端入口。启动前加载 .env，然后起 HTTP 服务。
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnv } from "./lib/load-env"
import { startServer } from "./server/api"

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = join(HERE, "..")
const REPO_ROOT = join(SERVER_ROOT, "..")

async function main(): Promise<void> {
  // 唯一环境文件：仓库根 `.env.local`（Next 与 worker 共用，不存在 server/.env）。
  await loadEnv(join(REPO_ROOT, ".env.local"))
  const port = Number(process.env.PORT) || 8787
  startServer(port)
}

main().catch((err) => {
  console.error("[server] 启动失败：", err)
  process.exit(1)
})
