import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BridgeApiClient, type DeviceIdentity } from "../src/index.js";

describe("BridgeApiClient", () => {
  it("pairs, exchanges an Ed25519 proof for a token, and signs session requests", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const identity: DeviceIdentity = {
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, ...(init ? { init } : {}) });
      if (url.endsWith("/pair")) {
        return Response.json({
          deviceId: "device-1",
          workspaceId: "workspace-1",
          deviceCredential: "credential-1",
        });
      }
      if (url.endsWith("/token")) {
        return Response.json({ accessToken: "access-token", expiresAt: "2099-01-01T00:00:00Z" });
      }
      return Response.json({ id: "session-1", state: "claimed", attempt: 1 });
    };
    const client = new BridgeApiClient({
      baseUrl: "https://purpleink.example.com",
      identity,
      fetch: fetcher,
      now: () => new Date("2026-07-24T00:00:00.000Z"),
      nonce: () => "12345678-1234-4234-8234-123456789012",
    });

    await client.pair({
      code: "123456",
      bridgeVersion: "0.1.0",
      egoVersion: "0.4.4.17",
      label: "My Mac",
    });
    await client.refreshAccessToken();
    await client.claim("session-1", 1);

    const pairBody = JSON.parse(String(requests[0]?.init?.body));
    expect(pairBody.publicKey).toBe(identity.publicKeyPem);
    expect(JSON.stringify(requests)).not.toContain(identity.privateKeyPem);
    const claimHeaders = new Headers(requests[2]?.init?.headers);
    expect(claimHeaders.get("authorization")).toBe("Bearer access-token");
    expect(claimHeaders.get("x-bridge-signature")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(claimHeaders.get("x-bridge-body-sha256")).toMatch(/^[0-9a-f]{64}$/);
  });
});
