import { describe, expect, it } from "vitest";
import { R2BridgeStore } from "@/lib/bridge/r2";

describe("R2BridgeStore", () => {
  it("creates a short-lived SigV4 PUT URL bound to key, MIME, bytes, and SHA-256", async () => {
    const store = new R2BridgeStore({
      accountId: "account-id",
      bucket: "purpleink-evidence",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      now: () => new Date("2026-07-24T00:00:00.000Z"),
    });
    const signed = await store.signPut({
      key: "workspaces/w/capture-sessions/s/attempt-1/node/result.png",
      mimeType: "image/png",
      bytes: 42,
      sha256: "a".repeat(64),
      expiresInSeconds: 300,
    });
    const url = new URL(signed.url);

    expect(url.hostname).toBe("account-id.r2.cloudflarestorage.com");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
    expect(signed.headers).toEqual({
      "content-length": "42",
      "content-type": "image/png",
      "x-amz-checksum-sha256": Buffer.from("a".repeat(64), "hex").toString("base64"),
      "x-amz-meta-sha256": "a".repeat(64),
    });
  });
});
