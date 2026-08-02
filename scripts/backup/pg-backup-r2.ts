/**
 * pg_dump 落 Cloudflare R2 的备份 CLI 入口。
 *
 * 用法：pnpm tsx scripts/backup/pg-backup-r2.ts
 *   - 连接串取 DATABASE_URL；对象存储取 S3_* 变量（缺失即报错，只提变量名，
 *     不回显值）。
 *   - 可选：PG_BACKUP_PREFIX（默认 backups/postgres/）、
 *     PG_BACKUP_RETAIN（缺省 14，非法值抛错）。
 *
 * 输出恒为单行 JSON：成功 {status:"ok",...result}；失败 {status:"failed",
 * message:稳定类别}，退出码 1。核心逻辑见 ./run-backup；常驻每日调度见 ./schedule。
 */
import { runBackupOnce } from "./run-backup";

void runBackupOnce()
  .then((result) => {
    console.log(JSON.stringify({ status: "ok", ...result }));
  })
  .catch((error: unknown) => {
    // 失败输出只给稳定类别；连接串/密钥值/原始 stderr 一律不回显。
    const message = error instanceof Error ? error.message : "BACKUP_FAILED";
    console.error(JSON.stringify({ status: "failed", message }));
    process.exitCode = 1;
  });
