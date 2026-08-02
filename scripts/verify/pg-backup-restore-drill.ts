/**
 * 隔离式 PostgreSQL 备份恢复演练（Task 5）。
 *
 * 一次性拉起 disposable 的 postgres:17.5-alpine（源/目标）与 minio 容器，用
 * 生成的测试专用凭据与随机名称/端口跑一次真实备份，再 pg_restore 到目标库并
 * 核对表与行，最后无论成败都强制清理。
 *
 * 备份 CLI（scripts/backup/pg-backup-r2.ts）在生产路径 Dockerfile.backup 镜像
 * 内执行：宿主不装 pg_dump，镜像内才有 postgresql-client-17。源/目标/minio 挂
 * 在专用 docker 网络 drill-net-<nonce> 上，容器间按容器名互访；minio 保留宿主
 * 端口映射，供宿主机侧 GetObject 取回 .dump 做 pg_restore。
 *
 * 用法：pnpm tsx scripts/verify/pg-backup-restore-drill.ts
 * 依赖：本机 docker 可用；演练会先构建 backup 镜像并拉取 postgres:17.5-alpine
 * 与 minio/minio（数分钟），只应在隔离环境手动执行。
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CreateBucketCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const PG_IMAGE = "postgres:17.5-alpine";
const MINIO_IMAGE = "minio/minio:latest";
const DB = "purpleink";
const DB_USER = "purpleink";
const BUCKET = "purpleink-backups";

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function command(
  bin: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}
): CommandResult {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    cwd: options.cwd,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function assertOk(result: CommandResult, context: string): void {
  if (result.status !== 0) {
    throw new Error(`${context} 失败（exit ${result.status ?? "null"}）`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("无法获取空闲端口")));
      }
    });
  });
}

function dockerRun(options: {
  name: string;
  image: string;
  env: Record<string, string>;
  network?: string;
  hostPorts?: Array<[number, number]>;
  extraArgs?: string[];
}): void {
  const args = ["run", "-d", "--name", options.name];
  if (options.network) args.push("--network", options.network);
  for (const [host, container] of options.hostPorts ?? []) {
    args.push("-p", `${host}:${container}`);
  }
  for (const [key, value] of Object.entries(options.env)) {
    args.push("-e", `${key}=${value}`);
  }
  args.push(options.image, ...(options.extraArgs ?? []));
  assertOk(command("docker", args), `docker run ${options.name}`);
}

function dockerRmForce(container: string): void {
  command("docker", ["rm", "--force", container]);
}

/** 容器内执行 psql/pg_restore 等 pg 客户端（host 连接 + PGPASSWORD）。 */
function pgExec(container: string, password: string, client: string, args: string[]): CommandResult {
  return command("docker", [
    "exec",
    "-e",
    `PGPASSWORD=${password}`,
    container,
    client,
    "-h",
    "127.0.0.1",
    "-U",
    DB_USER,
    "-d",
    DB,
    ...args,
  ]);
}

async function waitForPostgres(container: string, password: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (pgExec(container, password, "pg_isready", []).status === 0) return;
    await delay(1000);
  }
  throw new Error(`postgres 容器未就绪: ${container}`);
}

async function waitForMinio(port: number): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (command("curl", ["-fsS", `http://127.0.0.1:${port}/minio/health/live`]).status === 0) return;
    await delay(1000);
  }
  throw new Error(`minio 容器未就绪: 127.0.0.1:${port}`);
}

function seedSource(container: string, password: string): void {
  const sql = [
    "CREATE TABLE app_users (id serial PRIMARY KEY, email text NOT NULL);",
    "INSERT INTO app_users (email) VALUES ('drill@example.com'), ('drill-two@example.com');",
    "CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());",
    "INSERT INTO schema_migrations (version) VALUES ('0001_seed');",
  ].join("\n");
  assertOk(
    pgExec(container, password, "psql", ["-v", "ON_ERROR_STOP=1", "-c", sql]),
    "seed source"
  );
}

/** 在 drill 镜像里跑备份 CLI（镜像内才有 pg_dump），解析单行 JSON。 */
function runBackupCli(options: {
  network: string;
  sourceContainer: string;
  minioContainer: string;
  image: string;
  password: string;
  accessKey: string;
  secretKey: string;
  nonce: string;
}): string {
  const env: Record<string, string> = {
    DATABASE_URL: `postgres://${DB_USER}:${options.password}@${options.sourceContainer}:5432/${DB}`,
    S3_ENDPOINT: `http://${options.minioContainer}:9000`,
    S3_BUCKET: BUCKET,
    S3_REGION: "auto",
    S3_ACCESS_KEY_ID: options.accessKey,
    S3_SECRET_ACCESS_KEY: options.secretKey,
    PG_BACKUP_PREFIX: `backups/drill-${options.nonce}/`,
    PG_BACKUP_RETAIN: "3",
  };
  const args = ["run", "--rm", "--network", options.network];
  for (const [key, value] of Object.entries(env)) args.push("-e", `${key}=${value}`);
  args.push(options.image, "pnpm", "tsx", "scripts/backup/pg-backup-r2.ts");
  const result = command("docker", args);
  // 成功时单行 JSON 在 stdout；失败时退出码 1，单行 JSON 在 stderr。
  const output = (result.status === 0 ? result.stdout : result.stderr).trim();
  let parsed: { status?: string; key?: string; message?: string };
  try {
    parsed = JSON.parse(output) as { status?: string; key?: string; message?: string };
  } catch {
    throw new Error(`备份 CLI 输出不是单行 JSON：${output.slice(0, 200)}`);
  }
  if (parsed.status === "ok" && parsed.key) return parsed.key;
  throw new Error(`备份 CLI 失败：${parsed.message ?? "未知错误"}`);
}

async function fetchDump(
  minioPort: number,
  accessKey: string,
  secretKey: string,
  key: string,
  dumpFile: string
): Promise<void> {
  const s3 = new S3Client({
    endpoint: `http://127.0.0.1:${minioPort}`,
    region: "auto",
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,
  });
  const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!object.Body) throw new Error("GetObject 返回空 Body");
  const stream = object.Body as { transformToByteArray(): Promise<Uint8Array> };
  const bytes = await stream.transformToByteArray();
  await writeFile(dumpFile, Buffer.from(bytes));
}

function restore(destContainer: string, password: string, dumpFile: string): void {
  assertOk(
    command("docker", ["cp", dumpFile, `${destContainer}:/tmp/backup.dump`]),
    "docker cp dump"
  );
  assertOk(
    pgExec(destContainer, password, "pg_restore", ["-Fc", "/tmp/backup.dump"]),
    "pg_restore"
  );
}

function queryCount(destContainer: string, password: string, sql: string): number {
  const result = pgExec(destContainer, password, "psql", ["-tAc", sql]);
  assertOk(result, "psql 核对");
  const count = Number(result.stdout.trim());
  if (!Number.isInteger(count)) {
    throw new Error(`核对失败：${sql} -> ${result.stdout.trim()}`);
  }
  return count;
}

async function main(): Promise<void> {
  if (command("docker", ["version", "--format", "{{.Server.Version}}"]).status !== 0) {
    throw new Error("docker 不可用，跳过演练");
  }

  const nonce = randomUUID().replaceAll("-", "").slice(0, 8);
  const containers = [
    `pg-backup-drill-source-${nonce}`,
    `pg-backup-drill-dest-${nonce}`,
    `pg-backup-drill-minio-${nonce}`,
  ];
  const network = `drill-net-${nonce}`;
  const image = `purpleink-backup-drill-${nonce}`;
  const password = `drill_pw_${nonce}`;
  const accessKey = `drillkey${nonce}`;
  const secretKey = `drillsecret${nonce}`;
  const minioPort = await freePort();
  const workDir = await mkdtemp(path.join(tmpdir(), "pg-backup-drill-"));
  const dumpFile = path.join(workDir, "backup.dump");

  try {
    // 生产路径镜像：宿主没有 pg_dump，备份 CLI 必须在镜像内跑。
    assertOk(
      command("docker", ["build", "-f", "Dockerfile.backup", "-t", image, "."]),
      "docker build backup 镜像"
    );
    assertOk(
      command("docker", ["network", "create", network]),
      "docker network create"
    );

    const pgEnv = { POSTGRES_DB: DB, POSTGRES_USER: DB_USER, POSTGRES_PASSWORD: password };
    dockerRun({ name: containers[0], image: PG_IMAGE, env: pgEnv, network });
    dockerRun({ name: containers[1], image: PG_IMAGE, env: pgEnv, network });
    dockerRun({
      name: containers[2],
      image: MINIO_IMAGE,
      env: { MINIO_ROOT_USER: accessKey, MINIO_ROOT_PASSWORD: secretKey },
      network,
      hostPorts: [[minioPort, 9000]],
      extraArgs: ["server", "/data"],
    });

    await waitForPostgres(containers[0], password);
    await waitForPostgres(containers[1], password);
    await waitForMinio(minioPort);

    seedSource(containers[0], password);

    const s3 = new S3Client({
      endpoint: `http://127.0.0.1:${minioPort}`,
      region: "auto",
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      forcePathStyle: true,
    });
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));

    const key = runBackupCli({
      network,
      sourceContainer: containers[0],
      minioContainer: containers[2],
      image,
      password,
      accessKey,
      secretKey,
      nonce,
    });
    await fetchDump(minioPort, accessKey, secretKey, key, dumpFile);
    restore(containers[1], password, dumpFile);

    const users = queryCount(containers[1], password, "SELECT count(*) FROM app_users");
    const migrations = queryCount(containers[1], password, "SELECT count(*) FROM schema_migrations");
    const seedEmail = queryCount(
      containers[1],
      password,
      "SELECT count(*) FROM app_users WHERE email = 'drill@example.com'"
    );
    if (users !== 2 || migrations !== 1 || seedEmail !== 1) {
      throw new Error(`恢复核对不通过：users=${users}, migrations=${migrations}, seedEmail=${seedEmail}`);
    }

    console.log(JSON.stringify({ status: "ok", key, users, migrations, containers }));
  } finally {
    for (const name of containers) dockerRmForce(name);
    // 以下清理带 || true 容错：失败不掩盖演练结果。
    command("docker", ["network", "rm", network]);
    await rm(workDir, { recursive: true, force: true });
    command("docker", ["rmi", image]);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ status: "failed", message }));
  process.exitCode = 1;
});
