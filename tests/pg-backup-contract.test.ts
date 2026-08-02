import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import type { BackupDeps } from "../scripts/backup/run-backup";
import { parseRetain, runBackup } from "../scripts/backup/run-backup";
import {
  FIRST_RUN_DELAY_MS,
  RETRY_INTERVAL_MS,
  RUN_INTERVAL_MS,
  createScheduler,
} from "../scripts/backup/schedule";

// ---------------------------------------------------------------------------
// 部署契约：Zeabur Backup 服务、Dockerfile.backup、CI 矩阵。
// ---------------------------------------------------------------------------

const root = process.cwd();

async function text(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

type ZeaburEnvironment = Record<
  string,
  { default?: string; expose?: boolean; readonly?: boolean }
>;

interface ZeaburService {
  name: string;
  template: "GIT" | "PREBUILT";
  dependencies?: string[];
  spec: {
    id: string;
    source: {
      image?: string;
      github?: { branch?: string; repoID?: number };
    };
    env?: ZeaburEnvironment;
    ports?: unknown[];
    volumes?: Array<{ dir?: string; id?: string }>;
  };
}

interface ZeaburTemplate {
  apiVersion: string;
  kind: string;
  spec: { services: ZeaburService[] };
}

describe("Zeabur Backup service contract", () => {
  it("keeps exactly five services including Backup on the zeabur/deploy branch", async () => {
    const raw = await text("deploy/zeabur.template.yaml");
    const parsed = parse(raw) as ZeaburTemplate;
    expect(parsed.spec.services.map(({ name }) => name).sort()).toEqual([
      "backup",
      "migrate",
      "postgresql",
      "web",
      "worker",
    ]);

    const backup = parsed.spec.services.find(
      (candidate) => candidate.name === "backup"
    );
    expect(backup).toBeDefined();
    expect(backup?.template).toBe("GIT");
    expect(backup?.spec.source.github).toMatchObject({
      branch: "zeabur/deploy",
    });
    expect(backup?.dependencies).toEqual(["postgresql"]);
    expect(backup?.spec.ports).toBeUndefined();
    expect(backup?.spec.volumes).toBeUndefined();
  });

  it("limits Backup env to database, R2, and backup settings only", async () => {
    const parsed = parse(await text("deploy/zeabur.template.yaml")) as ZeaburTemplate;
    const backup = parsed.spec.services.find(
      (candidate) => candidate.name === "backup"
    );
    const env = Object.fromEntries(
      Object.entries(backup?.spec.env ?? {}).map(([key, value]) => [
        key,
        value.default,
      ])
    );
    expect(env).toEqual({
      DATABASE_URL: "${POSTGRES_CONNECTION_STRING}",
      S3_ENDPOINT: "",
      S3_BUCKET: "",
      S3_REGION: "auto",
      S3_ACCESS_KEY_ID: "",
      S3_SECRET_ACCESS_KEY: "",
      PG_BACKUP_PREFIX: "backups/postgres/",
      PG_BACKUP_RETAIN: "14",
    });
    expect(Object.keys(env).join("\n")).not.toMatch(
      /CVC_MANAGED_|CVC_MAIL_|STORAGE_MODE|PURPLEINK_/
    );
  });

  it("builds Dockerfile.backup on Node 22 with PostgreSQL client 17 and the scheduler CMD", async () => {
    const dockerfile = await text("Dockerfile.backup");
    expect(dockerfile).toMatch(/^FROM node:22-bookworm-slim/m);
    expect(dockerfile).toContain("postgresql-client-17");
    expect(dockerfile).not.toMatch(/node:24|postgresql-client-18/);
    expect(dockerfile).toContain("corepack prepare pnpm@10.30.0");
    expect(dockerfile).toContain("COPY scripts/backup");
    expect(dockerfile).toContain("schedule.ts");
  });

  it("adds Dockerfile.backup to the CI images matrix", async () => {
    const workflow = await text(".github/workflows/ci.yml");
    expect(workflow).toContain("./Dockerfile.backup");
  });
});

// ---------------------------------------------------------------------------
// 环境配置契约：PG_BACKUP_RETAIN 缺省 14，非法值抛错。
// ---------------------------------------------------------------------------

describe("PG_BACKUP_RETAIN parsing", () => {
  it("defaults to 14 when absent or blank", () => {
    expect(parseRetain(undefined)).toBe(14);
    expect(parseRetain("")).toBe(14);
    expect(parseRetain("   ")).toBe(14);
  });

  it("accepts positive integers and rejects invalid values", () => {
    expect(parseRetain("7")).toBe(7);
    for (const invalid of ["0", "-1", "1.5", "abc", "NaN", "Infinity"]) {
      expect(() => parseRetain(invalid)).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// 管线失败安全：注入的 S3 client / dump runner / clock / tempBase。
// ---------------------------------------------------------------------------

const DUMP_BYTES = Buffer.from(
  "PGDMP custom-format dump bytes for contract test",
  "utf8"
);
const SECRETS = {
  databaseUrl:
    "postgres://alice:supersecret-pw@db.internal.example.com:5432/proddb",
  endpoint: "https://s3.internal.example.com:9000",
  accessKey: "AKIA-DRILL-SECRET-KEY",
  secretKey: "super-secret-r2-access-secret",
};

const aws = vi.hoisted(() => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const state: {
    putError?: Error;
    headError?: Error;
    headResponse?: { ContentLength?: number };
    listError?: Error;
    listResponse?: {
      Contents?: Array<{ Key?: string }>;
      IsTruncated?: boolean;
      NextContinuationToken?: string;
    };
    deleteError?: Error;
  } = { listResponse: { Contents: [] } };

  class Command {
    readonly input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
      calls.push({ name: this.constructor.name, input });
    }
  }
  class PutObjectCommand extends Command {}
  class HeadObjectCommand extends Command {}
  class ListObjectsV2Command extends Command {}
  class DeleteObjectCommand extends Command {}

  class S3Client {
    async send(command: unknown): Promise<unknown> {
      const name = (command as { constructor: { name: string } }).constructor
        .name;
      if (name === "PutObjectCommand") {
        if (state.putError) throw state.putError;
        // R2 强一致：上传成功后 ListObjectsV2 立即包含新 key，fake 同步该语义。
        const uploadedKey = (command as { input: { Key?: string } }).input.Key;
        if (uploadedKey) {
          state.listResponse = state.listResponse ?? { Contents: [] };
          state.listResponse.Contents = state.listResponse.Contents ?? [];
          state.listResponse.Contents.push({ Key: uploadedKey });
        }
        return {};
      }
      if (name === "HeadObjectCommand") {
        if (state.headError) throw state.headError;
        return state.headResponse ?? {};
      }
      if (name === "ListObjectsV2Command") {
        if (state.listError) throw state.listError;
        return state.listResponse ?? { Contents: [] };
      }
      if (name === "DeleteObjectCommand") {
        if (state.deleteError) throw state.deleteError;
        return {};
      }
      return {};
    }
  }

  return {
    calls,
    state,
    S3Client,
    PutObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    DeleteObjectCommand,
  };
});

vi.mock("@aws-sdk/client-s3", () => aws);

function baseDeps(
  tempBase: string,
  overrides: Partial<BackupDeps> = {}
): BackupDeps {
  return {
    client: new aws.S3Client(),
    runDump: async (_databaseUrl: string, outFile: string) => {
      await writeFile(outFile, DUMP_BYTES);
    },
    now: () => new Date("2026-07-31T08:30:05.123Z"),
    tempBase,
    bucket: "backups",
    database: "proddb",
    prefix: "backups/postgres/",
    retain: 14,
    databaseUrl: SECRETS.databaseUrl,
    ...overrides,
  };
}

async function runAndCaptureError(
  options: Partial<BackupDeps> = {}
): Promise<{ message: string; calls: typeof aws.calls }> {
  const tempBase = await mkdtemp(path.join(tmpdir(), "pg-backup-contract-"));
  try {
    let message = "";
    try {
      await runBackup(baseDeps(tempBase, options));
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe("");
    // 唯一临时目录在失败路径也必须被清理干净。
    expect(await readdir(tempBase)).toEqual([]);
    return { message, calls: aws.calls };
  } finally {
    await rm(tempBase, { recursive: true, force: true });
  }
}

describe("backup pipeline failure safety", () => {
  beforeEach(() => {
    aws.calls.length = 0;
    // 原地重置字段，不能整体重赋 state——mock 的 send() 闭包持有原对象引用。
    aws.state.putError = undefined;
    aws.state.headError = undefined;
    aws.state.headResponse = undefined;
    aws.state.listError = undefined;
    aws.state.listResponse = { Contents: [] };
    aws.state.deleteError = undefined;
  });

  it("PG_DUMP_FAILED hides pg_dump stderr, connection string, and credentials", async () => {
    const rawStderr =
      'pg_dump: error: connection to server at "db.internal.example.com", port 5432 failed: password authentication failed for user "alice"';
    const { message, calls } = await runAndCaptureError({
      runDump: async () => {
        throw new Error(rawStderr);
      },
    });
    expect(message).toBe("PG_DUMP_FAILED");
    expect(message).not.toContain(SECRETS.databaseUrl);
    expect(message).not.toMatch(
      /stderr|db\.internal\.example\.com|supersecret|password authentication/i
    );
    expect(
      calls.some((call) => call.name === "PutObjectCommand")
    ).toBe(false);
  });

  it("PG_DUMP_EMPTY rejects empty dumps before any upload", async () => {
    const { message, calls } = await runAndCaptureError({
      runDump: async (_databaseUrl: string, outFile: string) => {
        await writeFile(outFile, Buffer.alloc(0));
      },
    });
    expect(message).toBe("PG_DUMP_EMPTY");
    expect(
      calls.some((call) => call.name === "PutObjectCommand")
    ).toBe(false);
  });

  it("R2_UPLOAD_FAILED hides underlying AWS errors", async () => {
    aws.state.putError = new Error(
      `AccessDenied: ${SECRETS.accessKey} against ${SECRETS.endpoint}`
    );
    const { message } = await runAndCaptureError();
    expect(message).toBe("R2_UPLOAD_FAILED");
    expect(message).not.toContain(SECRETS.accessKey);
    expect(message).not.toContain(SECRETS.endpoint);
  });

  it("R2_VERIFY_FAILED when HeadObject ContentLength is missing and rotation is skipped", async () => {
    aws.state.headResponse = {};
    const { message, calls } = await runAndCaptureError();
    expect(message).toBe("R2_VERIFY_FAILED");
    expect(
      calls.some((call) => call.name === "DeleteObjectCommand")
    ).toBe(false);
  });

  it("R2_VERIFY_FAILED when HeadObject ContentLength mismatches and rotation is skipped", async () => {
    aws.state.headResponse = { ContentLength: DUMP_BYTES.length + 1 };
    const { message, calls } = await runAndCaptureError();
    expect(message).toBe("R2_VERIFY_FAILED");
    expect(
      calls.some((call) => call.name === "DeleteObjectCommand")
    ).toBe(false);
  });

  it("R2_LIST_FAILED hides list errors", async () => {
    aws.state.headResponse = { ContentLength: DUMP_BYTES.length };
    aws.state.listError = new Error(
      `ListObjectsV2: ${SECRETS.secretKey} expired`
    );
    const { message } = await runAndCaptureError();
    expect(message).toBe("R2_LIST_FAILED");
    expect(message).not.toContain(SECRETS.secretKey);
  });

  it("R2_ROTATE_FAILED hides delete errors", async () => {
    aws.state.listResponse = {
      Contents: [
        { Key: "backups/postgres/2026-07-28T00-00-00-000Z-proddb.dump" },
        { Key: "backups/postgres/2026-07-29T00-00-00-000Z-proddb.dump" },
        { Key: "backups/postgres/2026-07-30T00-00-00-000Z-proddb.dump" },
      ],
    };
    aws.state.headResponse = { ContentLength: DUMP_BYTES.length };
    aws.state.deleteError = new Error(`DeleteObject: ${SECRETS.databaseUrl}`);
    const { message } = await runAndCaptureError({ retain: 2 });
    expect(message).toBe("R2_ROTATE_FAILED");
    expect(message).not.toContain(SECRETS.databaseUrl);
  });

  it("BACKUP_TEMP_FAILED hides raw OS errors when the temp directory cannot be created", async () => {
    const tempBase = await mkdtemp(path.join(tmpdir(), "pg-backup-contract-"));
    const blocker = path.join(tempBase, "blocker");
    await writeFile(blocker, "not a directory");
    try {
      const { message } = await runAndCaptureError({ tempBase: blocker });
      expect(message).toBe("BACKUP_TEMP_FAILED");
      expect(message).not.toMatch(/ENOTDIR|EACCES|mkdtemp/iu);
    } finally {
      await rm(tempBase, { recursive: true, force: true });
    }
  });

  it("uploads verified bytes, rotates stale backups, and cleans the unique temp dir", async () => {
    aws.state.headResponse = { ContentLength: DUMP_BYTES.length };
    aws.state.listResponse = {
      Contents: [
        { Key: "backups/postgres/2026-07-28T00-00-00-000Z-proddb.dump" },
        { Key: "backups/postgres/2026-07-29T00-00-00-000Z-proddb.dump" },
        { Key: "backups/postgres/2026-07-30T00-00-00-000Z-proddb.dump" },
        { Key: "backups/postgres/2026-07-31T00-00-00-000Z-proddb.dump" },
      ],
    };
    const tempBase = await mkdtemp(path.join(tmpdir(), "pg-backup-contract-"));
    try {
      const result = await runBackup(baseDeps(tempBase, { retain: 2 }));
      const expectedKey =
        "backups/postgres/2026-07-31T08-30-05-123Z-proddb.dump";
      expect(result.key).toBe(expectedKey);
      expect(result.sizeBytes).toBe(DUMP_BYTES.length);
      expect(result.sha256).toBe(
        createHash("sha256").update(DUMP_BYTES).digest("hex")
      );
      expect(result.retain).toBe(2);
      // R2 强一致：列表包含刚上传的新 key（共 5 个），retain=2 保留最新
      // 2 个（含新 key），删除最旧 3 个。
      expect(result.deleted).toEqual([
        "backups/postgres/2026-07-30T00-00-00-000Z-proddb.dump",
        "backups/postgres/2026-07-29T00-00-00-000Z-proddb.dump",
        "backups/postgres/2026-07-28T00-00-00-000Z-proddb.dump",
      ]);

      const put = aws.calls.find((call) => call.name === "PutObjectCommand");
      expect(put?.input.Key).toBe(expectedKey);
      expect(put?.input.Body).toEqual(DUMP_BYTES);

      const deletes = aws.calls.filter(
        (call) => call.name === "DeleteObjectCommand"
      );
      expect(deletes.map((call) => call.input.Key)).toEqual(result.deleted);
      expect(await readdir(tempBase)).toEqual([]);
    } finally {
      await rm(tempBase, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 常驻调度器：定时器必须 ref'd（否则 Dockerfile.backup 进程立即退出）；
// 成功/失败分别以 run/retry 间隔重排。冒烟测试用 5-20ms 真实短定时器。
// ---------------------------------------------------------------------------

describe("backup scheduler", () => {
  it("keeps the keep-alive timer ref'd (no .unref()) so the container stays resident", async () => {
    const source = await text("scripts/backup/schedule.ts");
    expect(source).not.toContain(".unref()");
  });

  it("keeps the production entrypoint delays: 10s first run, 24h success, 1h retry", () => {
    expect(FIRST_RUN_DELAY_MS).toBe(10 * 1000);
    expect(RUN_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
    expect(RETRY_INTERVAL_MS).toBe(60 * 60 * 1000);
  });

  it("runs once and reschedules with runInterval after success, logging single-line JSON", async () => {
    const logLines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((line: string) => {
      logLines.push(line);
    });
    let runs = 0;
    const key = "backups/postgres/2026-07-31T08-30-05-123Z-proddb.dump";
    const scheduler = createScheduler({
      firstDelayMs: 5,
      runIntervalMs: 20,
      retryIntervalMs: 15,
      run: async () => {
        runs += 1;
        return { key, sizeBytes: 42, sha256: "abc", retain: 2, deleted: [] };
      },
    });
    scheduler.start();
    try {
      await vi.waitFor(() => {
        expect(runs).toBeGreaterThanOrEqual(1);
        expect(scheduler.nextDelayMs()).toBe(20);
      });
      const line = logLines[0];
      expect(line).not.toContain("\n");
      expect(JSON.parse(line)).toMatchObject({ status: "ok", key });
    } finally {
      scheduler.stop();
      logSpy.mockRestore();
    }
  });

  it("reschedules with retryInterval after failure, logging single-line JSON with the stable category", async () => {
    const errorLines: string[] = [];
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation((line: string) => {
        errorLines.push(line);
      });
    let runs = 0;
    const scheduler = createScheduler({
      firstDelayMs: 5,
      runIntervalMs: 20,
      retryIntervalMs: 15,
      run: async () => {
        runs += 1;
        throw new Error("PG_DUMP_FAILED");
      },
    });
    scheduler.start();
    try {
      await vi.waitFor(() => {
        expect(runs).toBeGreaterThanOrEqual(1);
        expect(scheduler.nextDelayMs()).toBe(15);
      });
      const line = errorLines[0];
      expect(line).not.toContain("\n");
      expect(JSON.parse(line)).toMatchObject({
        status: "failed",
        message: "PG_DUMP_FAILED",
      });
    } finally {
      scheduler.stop();
      errorSpy.mockRestore();
    }
  });
});
