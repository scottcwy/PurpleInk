/**
 * pg_dump 落 Cloudflare R2 的一次备份核心逻辑。
 *
 * 环境变量：
 *   - DATABASE_URL：Postgres 连接串（必填）
 *   - S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY：对象存储（必填）
 *   - S3_REGION：可选，R2 固定 auto
 *   - PG_BACKUP_PREFIX：备份 key 前缀，默认 backups/postgres/
 *   - PG_BACKUP_RETAIN：保留份数，缺省 14；显式给出非法值直接抛错，绝不静默回退
 *
 * 流程：pg_dump -Fc 到唯一临时目录 → 按实际字节算 SHA-256 → 上传 R2 →
 *      HeadObject 核对字节数（不符即中止，不做轮转）→ 轮转删除超出保留份数的旧备份。
 * 失败只抛稳定类别（PG_DUMP_FAILED / PG_DUMP_EMPTY / R2_UPLOAD_FAILED /
 * R2_VERIFY_FAILED / R2_LIST_FAILED / R2_ROTATE_FAILED / BACKUP_TEMP_FAILED），
 * 连接串/密钥值/底层 AWS 错误/原始 stderr 一律不回显。
 * BACKUP_TEMP_FAILED 覆盖临时目录的创建与清理失败：mkdtemp 失败、finally 清理
 * 失败都归一为该类别（清理失败可能掩盖主错误，可接受，类别稳定）。
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { backupObjectKey, selectExpiredKeys } from "./rotation";

export interface BackupResult {
  key: string;
  sizeBytes: number;
  sha256: string;
  retain: number;
  deleted: string[];
}

/** 对象存储的最小接口：真实 S3Client 与测试替身都满足。 */
export interface BackupObjectStore {
  send(command: unknown): Promise<unknown>;
}

export interface BackupDeps {
  client: BackupObjectStore;
  runDump: (databaseUrl: string, outFile: string) => Promise<void>;
  now: () => Date;
  /** mkdtemp 的基目录；生产传 os.tmpdir()，测试传测试自己的唯一临时目录。 */
  tempBase: string;
  bucket: string;
  database: string;
  prefix: string;
  retain: number;
  databaseUrl: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

/** PG_BACKUP_RETAIN：缺省/空白 -> 14；显式给出非正整数 -> 抛错。 */
export function parseRetain(raw: string | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed) return 14;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`PG_BACKUP_RETAIN 必须是正整数，收到: ${trimmed}`);
  }
  return parsed;
}

/**
 * pg_dump 自定义格式（-Fc）。stderr 收集后直接丢弃——可能含主机名/连接细节，
 * 绝不写回进程 stderr，也绝不让原始内容进入异常消息。
 */
async function runPgDump(databaseUrl: string, outFile: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pg_dump",
      ["--format=custom", `--file=${outFile}`, `--dbname=${databaseUrl}`],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", () => {
      stderr.length = 0;
      reject(new Error("PG_DUMP_FAILED"));
    });
    child.on("close", (code) => {
      stderr.length = 0;
      if (code === 0) resolve();
      else reject(new Error("PG_DUMP_FAILED"));
    });
  });
}

async function listBackupKeys(
  client: BackupObjectStore,
  bucket: string,
  prefix: string
): Promise<string[]> {
  // 与 backupObjectKey 共用同一套前缀归一化：缺尾斜杠补上，避免匹配到
  // backups/postgresql/ 这类兄弟前缀。
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = (await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: normalizedPrefix,
        ContinuationToken: token,
      })
    )) as
      | {
          Contents?: Array<{ Key?: string }>;
          IsTruncated?: boolean;
          NextContinuationToken?: string;
        }
      | undefined;
    if (!page) throw new Error("R2_LIST_FAILED");
    for (const item of page.Contents ?? []) {
      if (item.Key) keys.push(item.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** 执行一次完整备份并返回结果；失败抛稳定类别文案，由调用方决定输出与重试。 */
export async function runBackup(deps: BackupDeps): Promise<BackupResult> {
  const {
    client,
    runDump,
    now,
    tempBase,
    bucket,
    database,
    prefix,
    retain,
    databaseUrl,
  } = deps;
  let workDirectory: string;
  try {
    workDirectory = await mkdtemp(path.join(tempBase, "pg-backup-"));
  } catch {
    throw new Error("BACKUP_TEMP_FAILED");
  }
  try {
    const dumpFile = path.join(workDirectory, `${randomUUID()}.dump`);
    try {
      await runDump(databaseUrl, dumpFile);
    } catch {
      throw new Error("PG_DUMP_FAILED");
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(dumpFile);
    } catch {
      throw new Error("PG_DUMP_FAILED");
    }
    if (bytes.length === 0) throw new Error("PG_DUMP_EMPTY");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const key = backupObjectKey({ prefix, database, timestamp: now() });

    try {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes })
      );
    } catch {
      throw new Error("R2_UPLOAD_FAILED");
    }

    // 上传后按远端元数据核对字节数，防半截对象混入备份序列；核对不过即中止，
    // 绝不进入轮转删除。
    let head: { ContentLength?: number } | undefined;
    try {
      head = (await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key })
      )) as { ContentLength?: number };
    } catch {
      throw new Error("R2_VERIFY_FAILED");
    }
    if (head === undefined || head.ContentLength !== bytes.length) {
      throw new Error("R2_VERIFY_FAILED");
    }

    let keys: string[];
    try {
      keys = await listBackupKeys(client, bucket, prefix);
    } catch {
      throw new Error("R2_LIST_FAILED");
    }
    const expired = selectExpiredKeys(keys, retain);
    try {
      for (const staleKey of expired) {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: staleKey })
        );
      }
    } catch {
      throw new Error("R2_ROTATE_FAILED");
    }

    return { key, sizeBytes: bytes.length, sha256, retain, deleted: expired };
  } finally {
    // 无论成功还是任意失败路径，都删除本次唯一的临时目录；清理失败归一为
    // 稳定类别 BACKUP_TEMP_FAILED（可能掩盖主错误，可接受，类别稳定）。
    try {
      await rm(workDirectory, { recursive: true, force: true });
    } catch {
      throw new Error("BACKUP_TEMP_FAILED");
    }
  }
}

/** 从环境变量组装配置并执行一次备份（Dockerfile.backup / CLI 的入口）。 */
export async function runBackupOnce(): Promise<BackupResult> {
  const databaseUrl = requireEnv("DATABASE_URL");
  const bucket = requireEnv("S3_BUCKET");
  const client = new S3Client({
    endpoint: requireEnv("S3_ENDPOINT"),
    region: process.env.S3_REGION?.trim() || "auto",
    credentials: {
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    },
    forcePathStyle: true,
  });
  const prefix = process.env.PG_BACKUP_PREFIX?.trim() || "backups/postgres/";
  const retain = parseRetain(process.env.PG_BACKUP_RETAIN);
  let database = "postgres";
  try {
    database = new URL(databaseUrl).pathname.replace(/^\/+/u, "") || "postgres";
  } catch {
    // URL 解析失败时 new URL 的原始消息可能带连接串——换成稳定类别。
    throw new Error("PG_DUMP_FAILED");
  }
  return runBackup({
    client,
    runDump: runPgDump,
    now: () => new Date(),
    tempBase: tmpdir(),
    bucket,
    database,
    prefix,
    retain,
    databaseUrl,
  });
}
