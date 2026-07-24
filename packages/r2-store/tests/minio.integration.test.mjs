import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { R2ObjectStore } from "../src/index.mjs";

const exec = promisify(execFile);
const image = "quay.io/minio/minio@sha256:54d3d6a0a58fb25b4e9943d1db3828d3b4de44666f911381b4fda57175488194";
const container = `purpleink-minio-${randomUUID()}`;
const accessKeyId = "purpleinktest";
const secretAccessKey = "purpleinktestsecret";
let endpoint;

beforeAll(async () => {
  await exec("docker", [
    "run", "-d", "--rm", "--name", container,
    "-e", `MINIO_ROOT_USER=${accessKeyId}`,
    "-e", `MINIO_ROOT_PASSWORD=${secretAccessKey}`,
    "-p", "127.0.0.1::9000", image, "server", "/data",
  ]);
  const port = (await exec("docker", ["port", container, "9000/tcp"])).stdout.trim().split(":").at(-1);
  endpoint = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${endpoint}/minio/health/live`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("MinIO did not become ready");
}, 30_000);

afterAll(async () => {
  await exec("docker", ["rm", "-f", container]).catch(() => undefined);
});

describe("R2ObjectStore S3-compatible boundary", () => {
  it("round-trips bytes and verified HEAD metadata through MinIO", async () => {
    const store = new R2ObjectStore({
      endpoint,
      region: "us-east-1",
      bucket: "purpleink-evidence",
      accessKeyId,
      secretAccessKey,
    });
    await store.createBucket();
    const key = "workspaces/test/capture-sessions/session/attempt-1/final/node/result.txt";
    const bytes = Buffer.from("real object-store boundary");
    await store.put(key, bytes, { contentType: "text/plain" });

    expect(await store.get(key)).toEqual(bytes);
    expect(await store.head(key)).toMatchObject({
      bytes: bytes.length,
      mimeType: "text/plain",
    });
    expect((await store.head(key)).sha256).toMatch(/^[0-9a-f]{64}$/);
  }, 30_000);
});
