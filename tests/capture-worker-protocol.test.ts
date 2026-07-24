import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CaptureJobRepository,
  CaptureProtocolError,
  captureObjectKey,
  publishEvidenceManifest,
  verifyEvidenceManifest,
} from "../packages/playwright-capture-worker/src/index.mjs";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const sessionId = "10000000-0000-4000-8000-000000000001";
const jobId = "20000000-0000-4000-8000-000000000001";
const imageDigest =
  "sha256:ffc33305f7b4b04057ae4a0caa70aad4fde87454fb403a1a22e7f931707dfcf9";

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("Playwright capture worker protocol", () => {
  it("fences a lease-lost attempt and lets a new attempt recover", () => {
    const repository = new CaptureJobRepository();
    repository.create({
      id: jobId,
      workspaceId,
      captureSessionId: sessionId,
      attempt: 1,
      imageDigest,
    });
    const first = repository.lease({ jobId, attempt: 1, ttlMs: 10 });
    repository.expireLease(jobId, first.leaseToken);
    repository.create({
      id: jobId,
      workspaceId,
      captureSessionId: sessionId,
      attempt: 2,
      imageDigest,
    });
    const second = repository.lease({ jobId, attempt: 2, ttlMs: 30_000 });

    expect(() =>
      repository.complete({
        jobId,
        attempt: 1,
        leaseToken: first.leaseToken,
        manifestHash: "a".repeat(64),
      })
    ).toThrow(/STALE_ATTEMPT/);
    expect(
      repository.complete({
        jobId,
        attempt: 2,
        leaseToken: second.leaseToken,
        manifestHash: "b".repeat(64),
      }).status
    ).toBe("completed");
  });

  it("creates attempt-isolated quarantine and final keys", () => {
    expect(
      captureObjectKey({
        workspaceId,
        sessionId,
        attempt: 3,
        disposition: "quarantine",
        nodeId: "result",
        filename: "screen.png",
      })
    ).toBe(
      `workspaces/${workspaceId}/capture-sessions/${sessionId}/attempt-3/quarantine/result/screen.png`
    );
    expect(
      captureObjectKey({
        workspaceId,
        sessionId,
        attempt: 3,
        disposition: "final",
        nodeId: "result",
        filename: "screen.png",
      })
    ).toContain("/attempt-3/final/");
  });

  it("rejects a manifest when object HEAD metadata does not match", async () => {
    const bytes = Buffer.from("real screenshot bytes");
    const key = captureObjectKey({
      workspaceId,
      sessionId,
      attempt: 1,
      disposition: "final",
      nodeId: "result",
      filename: "screen.png",
    });
    const manifest = {
      schemaVersion: "evidence-manifest/v1",
      workspaceId,
      captureSessionId: sessionId,
      jobId,
      attempt: 1,
      runId: "30000000-0000-4000-8000-000000000001",
      flowVersionId: "40000000-0000-4000-8000-000000000001",
      imageDigest,
      actionJournalHash: "c".repeat(64),
      entries: [
        {
          nodeId: "result",
          kind: "result_screenshot",
          r2Key: key,
          mimeType: "image/png",
          bytes: bytes.length,
          sha256: sha256(bytes),
          redactionStatus: "passed",
        },
      ],
    } as const;

    await expect(
      verifyEvidenceManifest(manifest, {
        async head() {
          return {
            bytes: bytes.length + 1,
            sha256: sha256(bytes),
            mimeType: "image/png",
          };
        },
      })
    ).rejects.toBeInstanceOf(CaptureProtocolError);
  });

  it("uploads through metadata-bound signed URLs without bucket credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "purpleink-signed-upload-"));
    const asset = Buffer.from("signed evidence bytes");
    await writeFile(join(directory, "result.png"), asset);
    const received: Buffer[] = [];
    const server = createServer(async (request, response) => {
      if (request.method === "POST" && request.url === "/sign") {
        let body = "";
        for await (const chunk of request) body += chunk;
        const payload = JSON.parse(body);
        expect(request.headers.authorization).toBe("Bearer workload-token");
        expect(payload.entries[0]).toMatchObject({
          bytes: asset.length,
          sha256: sha256(asset),
          mimeType: "image/png",
        });
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("test server has no TCP port");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ uploads: [{
          r2Key: payload.entries[0].r2Key,
          url: `http://127.0.0.1:${address.port}/upload`,
          headers: { "content-type": "image/png" },
        }] }));
        return;
      }
      if (request.method === "PUT" && request.url === "/upload") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        received.push(Buffer.concat(chunks));
        response.writeHead(200).end();
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    try {
      const entry = {
        nodeId: "result",
        kind: "result_screenshot",
        localPath: "result.png",
        r2Key: "workspaces/w/capture-sessions/s/attempt-1/final/result/result.png",
        mimeType: "image/png",
        bytes: asset.length,
        sha256: sha256(asset),
        redactionStatus: "passed",
      };
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server has no TCP port");
      await publishEvidenceManifest({
        manifest: { workspaceId: "w", captureSessionId: "s", jobId: "j", attempt: 1, entries: [entry] },
        outputDir: directory,
        signUploadsUrl: `http://127.0.0.1:${address.port}/sign`,
        workloadToken: "workload-token",
      });
      expect(received).toEqual([asset]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
