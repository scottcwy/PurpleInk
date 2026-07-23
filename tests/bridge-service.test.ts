import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BridgeError,
  BridgeService,
  deviceRequestChallenge,
  deviceTokenChallenge,
  sha256Hex,
  stableJson,
  type BridgeObjectStore,
  type BridgeUploadSigner,
} from "@/lib/bridge/service";
import type { EvidenceManifestV1 } from "@purpleink/ego-capture-bridge";

const ids = {
  workspace: "00000000-0000-4000-8000-000000000001",
  user: "10000000-0000-4000-8000-000000000001",
  product: "20000000-0000-4000-8000-000000000001",
  release: "30000000-0000-4000-8000-000000000001",
  session: "40000000-0000-4000-8000-000000000001",
  run: "50000000-0000-4000-8000-000000000001",
  flow: "60000000-0000-4000-8000-000000000001",
};

class TestStore implements BridgeUploadSigner, BridgeObjectStore {
  readonly objects = new Map<string, { bytes: number; sha256: string; mimeType: string }>();

  async signPut(input: {
    key: string;
    bytes: number;
    sha256: string;
    mimeType: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; headers: Record<string, string>; expiresAt: string }> {
    return {
      url: `https://r2.example.com/${encodeURIComponent(input.key)}?signed=true`,
      headers: {
        "content-type": input.mimeType,
        "content-length": String(input.bytes),
        "x-amz-checksum-sha256": input.sha256,
      },
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000).toISOString(),
    };
  }

  async head(key: string) {
    return this.objects.get(key) ?? null;
  }
}

function createHarness() {
  let now = new Date("2026-07-24T00:00:00.000Z");
  const store = new TestStore();
  const service = new BridgeService({
    now: () => now,
    tokenSecret: Buffer.from("test-secret-that-is-at-least-32-bytes"),
    uploadSigner: store,
    objectStore: store,
  });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  async function pair() {
    const pairing = service.issuePairingCode({
      workspaceId: ids.workspace,
      userId: ids.user,
    });
    return service.pair({
      code: pairing.code,
      publicKey: publicKeyPem,
      bridgeVersion: "0.1.0",
      egoVersion: "0.4.4.17",
      label: "Test Mac",
    });
  }

  function tokenFor(paired: Awaited<ReturnType<typeof pair>>) {
    const timestamp = now.toISOString();
    const nonce = crypto.randomUUID();
    const signature = sign(
      null,
      Buffer.from(deviceTokenChallenge(paired.deviceId, timestamp, nonce)),
      privateKey,
    ).toString("base64url");
    return service.createAccessToken({
      deviceId: paired.deviceId,
      deviceCredential: paired.deviceCredential,
      timestamp,
      nonce,
      signature,
    });
  }

  async function authenticate() {
    const paired = await pair();
    return { paired, token: tokenFor(paired).accessToken };
  }

  async function session() {
    const auth = await authenticate();
    const created = service.createSession({
      id: ids.session,
      workspaceId: ids.workspace,
      productId: ids.product,
      releaseId: ids.release,
      deviceId: auth.paired.deviceId,
      kind: "capture",
      attempt: 1,
      runId: ids.run,
      flowVersionId: ids.flow,
      allowedOrigins: ["https://app.example.com"],
    });
    return { ...auth, created };
  }

  return {
    service,
    store,
    privateKey,
    get now() {
      return now;
    },
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    pair,
    tokenFor,
    authenticate,
    session,
  };
}

function validEntries(deviceId: string) {
  const prefix = `workspaces/${ids.workspace}/capture-sessions/${ids.session}/attempt-1`;
  const make = (kind: string, extension: string, mimeType: string) => ({
    nodeId: "node-1",
    kind,
    r2Key: `${prefix}/node-1/${kind}.${extension}`,
    mimeType,
    bytes: 12,
    sha256: sha256Hex(`${deviceId}-${kind}`),
    redactionStatus: "passed" as const,
  });
  return [
    make("result_screenshot", "png", "image/png"),
    make("node_clip", "webm", "video/webm"),
    make("assertion_report", "json", "application/json"),
    make("dom_summary", "json", "application/json"),
  ];
}

describe("Bridge pairing and authentication", () => {
  it("consumes a six-digit pairing code once and registers the public key", async () => {
    const harness = createHarness();
    const pairing = harness.service.issuePairingCode({
      workspaceId: ids.workspace,
      userId: ids.user,
    });
    expect(pairing.code).toMatch(/^\d{6}$/);
    const { publicKey } = generateKeyPairSync("ed25519");
    const request = {
      code: pairing.code,
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      bridgeVersion: "0.1.0",
      egoVersion: "0.4.4.17",
      label: "MacBook",
    };

    await expect(harness.service.pair(request)).resolves.toMatchObject({
      workspaceId: ids.workspace,
    });
    await expect(harness.service.pair(request)).rejects.toMatchObject({ code: "pairing_code_invalid" });
  });

  it("rejects forged and replayed device signatures", async () => {
    const harness = createHarness();
    const paired = await harness.pair();
    const timestamp = harness.now.toISOString();
    const nonce = crypto.randomUUID();
    const forged = sign(
      null,
      Buffer.from(deviceTokenChallenge(paired.deviceId, timestamp, nonce)),
      generateKeyPairSync("ed25519").privateKey,
    ).toString("base64url");

    expect(() =>
      harness.service.createAccessToken({
        deviceId: paired.deviceId,
        deviceCredential: paired.deviceCredential,
        timestamp,
        nonce,
        signature: forged,
      }),
    ).toThrowError(BridgeError);
  });

  it("rejects a forged short-lived access token", async () => {
    const harness = createHarness();
    const { token } = await harness.authenticate();
    expect(() => harness.service.authenticate(`${token.slice(0, -1)}x`)).toThrow(/token/i);
  });

  it("requires a fresh device signature on authenticated requests", async () => {
    const harness = createHarness();
    const { paired, token } = await harness.authenticate();
    const timestamp = harness.now.toISOString();
    const nonce = crypto.randomUUID();
    const bodyHash = sha256Hex("{}");
    const signature = sign(
      null,
      Buffer.from(
        deviceRequestChallenge(
          "POST",
          `/api/bridge/v1/sessions/${ids.session}/claim`,
          timestamp,
          nonce,
          bodyHash,
        ),
      ),
      harness.privateKey,
    ).toString("base64url");
    const request = {
      token,
      method: "POST",
      path: `/api/bridge/v1/sessions/${ids.session}/claim`,
      timestamp,
      nonce,
      bodyHash,
      signature,
    };

    expect(harness.service.authenticateRequest(request).deviceId).toBe(paired.deviceId);
    expect(() => harness.service.authenticateRequest(request)).toThrow(/replayed/i);
  });
});

describe("CaptureSession lifecycle", () => {
  it("atomically claims the bound session and makes repeated claims idempotent", async () => {
    const harness = createHarness();
    const { token } = await harness.session();
    const first = harness.service.claim(token, ids.session, 1);
    const second = harness.service.claim(token, ids.session, 1);
    expect(first).toEqual(second);
    expect(first.state).toBe("claimed");
  });

  it("tracks awaiting_user and only resumes after local confirmation", async () => {
    const harness = createHarness();
    const { token } = await harness.session();
    harness.service.claim(token, ids.session, 1);
    expect(
      harness.service.heartbeat(token, ids.session, 1, {
        reportedState: "awaiting_user",
        currentNodeId: "node-1",
        currentActionId: "login",
      }).state,
    ).toBe("awaiting_user");
    expect(() =>
      harness.service.heartbeat(token, ids.session, 1, {
        reportedState: "running",
        currentNodeId: "node-1",
        currentActionId: "login",
      }),
    ).toThrow(/resume confirmation/i);
    expect(
      harness.service.heartbeat(token, ids.session, 1, {
        reportedState: "running",
        resumeConfirmed: true,
        currentNodeId: "node-1",
        currentActionId: "login",
      }).state,
    ).toBe("running");
  });

  it("marks connectivity disconnected after 30 seconds without changing state", async () => {
    const harness = createHarness();
    const { token } = await harness.session();
    harness.service.claim(token, ids.session, 1);
    harness.service.heartbeat(token, ids.session, 1, { reportedState: "running" });
    harness.advance(30_001);
    harness.service.sweepConnectivity();
    expect(harness.service.getSession(ids.session)).toMatchObject({
      state: "running",
      connectivity: "disconnected",
    });
  });

  it("deduplicates identical event seq and rejects conflicting duplicates", async () => {
    const harness = createHarness();
    const { token } = await harness.session();
    harness.service.claim(token, ids.session, 1);
    const event = { seq: 1, type: "action_completed", payload: { actionId: "a-1" } };
    expect(harness.service.appendEvents(token, ids.session, 1, [event]).accepted).toBe(1);
    expect(harness.service.appendEvents(token, ids.session, 1, [event]).accepted).toBe(0);
    expect(() =>
      harness.service.appendEvents(token, ids.session, 1, [
        { ...event, payload: { actionId: "different" } },
      ]),
    ).toThrow(/conflict/i);
  });

  it("expires a session and rejects further claims", async () => {
    const harness = createHarness();
    const { paired } = await harness.session();
    harness.advance(30 * 60_000 + 1);
    const token = harness.tokenFor(paired).accessToken;
    expect(() => harness.service.claim(token, ids.session, 1)).toThrow(/expired/i);
    expect(harness.service.getSession(ids.session).state).toBe("expired");
  });

  it("fails with a stable code and cancels unfinished sessions on revoke", async () => {
    const failedHarness = createHarness();
    const failed = await failedHarness.session();
    failedHarness.service.claim(failed.token, ids.session, 1);
    expect(
      failedHarness.service.fail(failed.token, ids.session, 1, {
        errorCode: "ego_navigation_failed",
        diagnostic: "navigation failed without secrets",
      }).state,
    ).toBe("failed");

    const revokedHarness = createHarness();
    const active = await revokedHarness.session();
    revokedHarness.service.revokeDevice(ids.workspace, active.paired.deviceId);
    expect(revokedHarness.service.getSession(ids.session).state).toBe("cancelled");
    expect(() => revokedHarness.service.authenticate(active.token)).toThrow(/revoked/i);
  });
});

describe("EvidenceManifestV1 upload boundary", () => {
  it("binds signed upload URLs and completes only after SHA-256 verification", async () => {
    const harness = createHarness();
    const { paired, token } = await harness.session();
    harness.service.claim(token, ids.session, 1);
    harness.service.heartbeat(token, ids.session, 1, { reportedState: "running" });
    const entries = validEntries(paired.deviceId);
    const signed = await harness.service.signUploads(token, ids.session, 1, entries);
    expect(signed).toHaveLength(4);
    expect(signed[0]?.headers).toMatchObject({
      "content-length": "12",
      "content-type": "image/png",
    });
    for (const entry of entries) {
      harness.store.objects.set(entry.r2Key, {
        bytes: entry.bytes,
        sha256: entry.sha256,
        mimeType: entry.mimeType,
      });
    }
    const manifest: EvidenceManifestV1 = {
      schemaVersion: "evidence-manifest/v1",
      captureSessionId: ids.session,
      runId: ids.run,
      flowVersionId: ids.flow,
      entries: entries as EvidenceManifestV1["entries"],
    };

    const completed = await harness.service.complete(
      token,
      ids.session,
      1,
      manifest,
      sha256Hex(stableJson(manifest)),
    );
    expect(completed.state).toBe("completed");
    expect(completed.manifestHash).toBe(sha256Hex(stableJson(manifest)));
  });

  it.each([
    { r2Key: "workspaces/other/capture-sessions/foreign/trace.zip" },
    { r2Key: `workspaces/${ids.workspace}/capture-sessions/${ids.session}/attempt-1/../secret` },
    { redactionStatus: "blocked" },
    { bytes: 0 },
    { sha256: "not-a-hash" },
  ])("rejects a malicious manifest entry", async (mutation) => {
    const harness = createHarness();
    const { paired, token } = await harness.session();
    harness.service.claim(token, ids.session, 1);
    const entries = validEntries(paired.deviceId);
    const manifest = {
      schemaVersion: "evidence-manifest/v1",
      captureSessionId: ids.session,
      runId: ids.run,
      flowVersionId: ids.flow,
      entries: [{ ...entries[0], ...mutation }, ...entries.slice(1)],
    };
    await expect(
      harness.service.complete(
        token,
        ids.session,
        1,
        manifest,
        sha256Hex(stableJson(manifest)),
      ),
    ).rejects.toThrow();
  });

  it("rejects an upload whose MIME does not match its evidence kind", async () => {
    const harness = createHarness();
    const { paired, token } = await harness.session();
    harness.service.claim(token, ids.session, 1);
    const [screenshot] = validEntries(paired.deviceId);
    await expect(
      harness.service.signUploads(token, ids.session, 1, [
        { ...screenshot, mimeType: "text/html" },
      ]),
    ).rejects.toThrow(/mime/i);
  });
});
