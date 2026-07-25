// Purple Ink 后端入口。启动前加载 .env，然后起 HTTP 服务。
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnv } from "./lib/load-env"
import { startServer } from "./server/api"

process.on('unhandledRejection', (reason, promise) => {
  console.error('[fatal] unhandledRejection at:', promise, 'reason:', reason)
})
process.on('uncaughtException', (err, origin) => {
  console.error('[fatal] uncaughtException origin:', origin, 'error:', err)
})
process.on('SIGTERM', () => {
  console.error('[fatal] SIGTERM received')
})
process.on('SIGINT', () => {
  console.error('[fatal] SIGINT received')
})

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = join(HERE, "..")

async function main(): Promise<void> {
  await loadEnv(join(SERVER_ROOT, ".env"))
  const port = Number(process.env.PORT) || 8787
  startServer(port)
}

main().catch((err) => {
  console.error("[server] 启动失败：", err)
  process.exit(1)
})
