/**
 * pg_dump 落 Cloudflare R2 的每日备份脚本（Zeabur 部署 §4，zeabur-plan.md）。
 *
 * 用法：pnpm tsx scripts/backup/pg-backup-r2.ts
 *   - 连接串取 DATABASE_URL；对象存储取与 Web 相同的 S3_* 变量（缺失即报错，
 *     只提变量名，不回显值）。
 *   - 可选：PG_BACKUP_PREFIX（默认 backups/postgres/）、
 *     PG_BACKUP_RETAIN（保留份数，默认 14）。
 *
 * 流程：pg_dump -Fc 到临时文件 → 按实际字节算 SHA-256 → 上传 R2 →
 *      HeadObject 核对字节数 → 轮转删除超出保留份数的旧备份。
 * 输出恒为单行 JSON（成功含 key/sizeBytes/sha256/deleted；失败只给类别）。
 */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { backupObjectKey, selectExpiredKeys } from './rotation'

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`缺少环境变量 ${name}`)
  return value
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw ?? '')
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** pg_dump 自定义格式（-Fc），失败时只透传退出码，不回显连接串。 */
async function runPgDump(databaseUrl: string, outFile: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'pg_dump',
      ['--format=custom', `--file=${outFile}`, `--dbname=${databaseUrl}`],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    )
    const stderr: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) return resolve()
      // stderr 可能包含主机名等连接细节，只落到本进程终端，不进对象存储。
      process.stderr.write(Buffer.concat(stderr))
      reject(new Error(`pg_dump 退出码 ${code}`))
    })
  })
}

async function listBackupKeys(
  client: S3Client,
  bucket: string,
  prefix: string
): Promise<string[]> {
  const keys: string[] = []
  let token: string | undefined
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      })
    )
    for (const item of page.Contents ?? []) {
      if (item.Key) keys.push(item.Key)
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return keys
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL')
  const bucket = requireEnv('S3_BUCKET')
  const client = new S3Client({
    endpoint: requireEnv('S3_ENDPOINT'),
    region: process.env.S3_REGION?.trim() || 'auto',
    credentials: {
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    },
    forcePathStyle: true,
  })
  const prefix = process.env.PG_BACKUP_PREFIX?.trim() || 'backups/postgres/'
  const retain = positiveInt(process.env.PG_BACKUP_RETAIN, 14)
  const database = new URL(databaseUrl).pathname.replace(/^\//u, '') || 'postgres'

  const workDirectory = await mkdtemp(path.join(tmpdir(), 'pg-backup-'))
  try {
    const dumpFile = path.join(workDirectory, `${randomUUID()}.dump`)
    await runPgDump(databaseUrl, dumpFile)
    const bytes = await readFile(dumpFile)
    if (bytes.length === 0) throw new Error('pg_dump 产物为空')
    const sha256 = createHash('sha256').update(bytes).digest('hex')

    const key = backupObjectKey({ prefix, database, timestamp: new Date() })
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes })
    )
    // 上传后按远端元数据核对字节数，防半截对象混入备份序列。
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key })
    )
    if (head.ContentLength !== bytes.length) {
      throw new Error(
        `上传核对失败：远端 ${head.ContentLength} != 本地 ${bytes.length}`
      )
    }

    const expired = selectExpiredKeys(
      await listBackupKeys(client, bucket, prefix),
      retain
    )
    for (const staleKey of expired) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: staleKey }))
    }

    console.log(
      JSON.stringify({
        status: 'ok',
        key,
        sizeBytes: bytes.length,
        sha256,
        retain,
        deleted: expired,
      })
    )
  } finally {
    await rm(workDirectory, { recursive: true, force: true })
  }
}

void main().catch((error: unknown) => {
  // 失败输出只给类别文案；连接串/密钥值一律不回显。
  const message = error instanceof Error ? error.message : 'BACKUP_FAILED'
  console.error(JSON.stringify({ status: 'failed', message }))
  process.exitCode = 1
})
