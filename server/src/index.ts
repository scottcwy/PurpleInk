// Purple Ink 后端入口。启动前加载 .env，然后起 HTTP 服务。
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnv } from "./lib/load-env"
import { startServer } from "./server/api"
import { reconcileOrphanJobs } from "./server/job-db"

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = join(HERE, "..")
const REPO_ROOT = join(SERVER_ROOT, "..")

async function main(): Promise<void> {
  await loadEnv(join(SERVER_ROOT, ".env"))
  await loadEnv(join(REPO_ROOT, ".env.local"))
  const port = Number(process.env.PORT) || 8787
  // 先对账再听端口：上次进程留下的 queued/running 孤儿任务统一标 failed。
  await reconcileOrphanJobs()
  startServer(port)
}

main().catch((err) => {
  console.error("[server] 启动失败：", err)
  process.exit(1)
})
