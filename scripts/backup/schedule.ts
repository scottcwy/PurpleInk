/**
 * 每日备份常驻调度器（Dockerfile.backup 的 CMD）。
 *
 * 为什么不用 crond：容器环境变量不会进入 cron 的执行环境，注入需要把含
 * secret 的环境写盘再 source；Node 调度天然继承容器 env，无明文落盘。
 *
 * 行为：启动 10s 后首跑（等容器网络/DNS 就绪），成功后每 24h 一次；
 * 失败则 1 小时后自动重试，避免单次网络抖动漏掉一整天的备份。
 * 每次运行输出恒为单行 JSON，直接进容器日志。
 */
import { runBackupOnce } from './run-backup'

const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000
const RETRY_INTERVAL_MS = 60 * 60 * 1000
const FIRST_RUN_DELAY_MS = 10 * 1000

function scheduleNext(delayMs: number): void {
  setTimeout(() => {
    void tick()
  }, delayMs).unref()
}

async function tick(): Promise<void> {
  const at = new Date().toISOString()
  try {
    const result = await runBackupOnce()
    console.log(JSON.stringify({ at, status: 'ok', ...result }))
    scheduleNext(RUN_INTERVAL_MS)
  } catch (error: unknown) {
    // 失败只给类别文案；连接串/密钥值不回显，原始错误由 pg_dump stderr 落到容器日志。
    const message = error instanceof Error ? error.message : 'BACKUP_FAILED'
    console.error(JSON.stringify({ at, status: 'failed', message }))
    scheduleNext(RETRY_INTERVAL_MS)
  }
}

scheduleNext(FIRST_RUN_DELAY_MS)
