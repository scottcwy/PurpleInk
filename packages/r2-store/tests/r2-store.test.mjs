import { describe, expect, it } from "vitest";
import { R2ObjectStore } from "../src/index.mjs";

describe("R2ObjectStore", () => {
  it("writes and reads immutable objects through scoped SigV4 requests", async () => {
    const requests = [];
    const fetcher = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (init.method === "GET") return new Response(Buffer.from("bundle"));
      return new Response(null, { status: 200, headers: {
        "content-length": "6", "content-type": "text/plain", "x-amz-meta-sha256": "a".repeat(64),
      } });
    };
    const store = new R2ObjectStore({
      accountId: "account", bucket: "purpleink", accessKeyId: "key",
      secretAccessKey: "secret", now: () => new Date("2026-07-24T00:00:00.000Z"), fetch: fetcher,
    });

    await store.put("workspaces/w/jobs/j/attempt-1/manifest.json", Buffer.from("bundle"), { contentType: "text/plain" });
    const bytes = await store.get("workspaces/w/jobs/j/attempt-1/manifest.json");

    expect(bytes.toString()).toBe("bundle");
    expect(requests).toHaveLength(2);
    expect(new URL(requests[0].url).searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(requests[0].init.headers["x-amz-meta-sha256"]).toMatch(/^[a-f0-9]{64}$/);
    expect(requests[1].init.method).toBe("GET");
  });
});
