import {
  generateKeyPairSync,
  sign,
  createHash,
} from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EvidenceEntryV1, EvidenceManifestV1 } from "./protocol.js";

const execFileAsync = promisify(execFile);

export type DeviceIdentity = {
  publicKeyPem: string;
  privateKeyPem: string;
};

type PairedDevice = {
  deviceId: string;
  workspaceId: string;
  deviceCredential: string;
};

type ClientOptions = {
  baseUrl: string;
  identity: DeviceIdentity;
  fetch?: typeof fetch;
  now?: () => Date;
  nonce?: () => string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function tokenChallenge(deviceId: string, timestamp: string, nonce: string): string {
  return `purpleink-bridge-token/v1\n${deviceId}\n${timestamp}\n${nonce}`;
}

function requestChallenge(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  bodyHash: string,
): string {
  return [
    "purpleink-bridge-request/v1",
    method.toUpperCase(),
    path,
    timestamp,
    nonce,
    bodyHash,
  ].join("\n");
}

export class MacKeychainIdentityStore {
  constructor(
    private readonly service = "com.purpleink.ego-capture-bridge",
    private readonly account = "device-identity",
  ) {}

  async loadOrCreate(): Promise<DeviceIdentity> {
    try {
      const result = await execFileAsync("security", [
        "find-generic-password",
        "-s",
        this.service,
        "-a",
        this.account,
        "-w",
      ]);
      return JSON.parse(result.stdout.trim()) as DeviceIdentity;
    } catch {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const identity: DeviceIdentity = {
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
        privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      };
      await execFileAsync("security", [
        "add-generic-password",
        "-U",
        "-s",
        this.service,
        "-a",
        this.account,
        "-w",
        JSON.stringify(identity),
      ]);
      return identity;
    }
  }
}

export class BridgeApiClient {
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly nonce: () => string;
  private paired?: PairedDevice;
  private accessToken?: string;

  constructor(private readonly options: ClientOptions) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.nonce = options.nonce ?? (() => crypto.randomUUID());
  }

  async pair(input: {
    code: string;
    bridgeVersion: string;
    egoVersion: string;
    label: string;
  }): Promise<PairedDevice> {
    this.paired = await this.request<PairedDevice>("/api/bridge/v1/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, publicKey: this.options.identity.publicKeyPem }),
    });
    return this.paired;
  }

  async refreshAccessToken(): Promise<{ accessToken: string; expiresAt: string }> {
    const paired = this.requirePaired();
    const timestamp = this.now().toISOString();
    const nonce = this.nonce();
    const signature = this.sign(tokenChallenge(paired.deviceId, timestamp, nonce));
    const result = await this.request<{ accessToken: string; expiresAt: string }>(
      "/api/bridge/v1/token",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deviceId: paired.deviceId,
          deviceCredential: paired.deviceCredential,
          timestamp,
          nonce,
          signature,
        }),
      },
    );
    this.accessToken = result.accessToken;
    return result;
  }

  async nextSession(waitSeconds = 25) {
    return this.signedRequest(`/api/bridge/v1/sessions/next?wait=${waitSeconds}`, "GET");
  }

  async claim(sessionId: string, attempt: number) {
    return this.signedRequest(`/api/bridge/v1/sessions/${sessionId}/claim`, "POST", {
      attempt,
    });
  }

  async heartbeat(
    sessionId: string,
    attempt: number,
    heartbeat: Record<string, unknown>,
  ) {
    return this.signedRequest(`/api/bridge/v1/sessions/${sessionId}/heartbeat`, "POST", {
      attempt,
      ...heartbeat,
    });
  }

  async appendEvents(sessionId: string, attempt: number, events: unknown[]) {
    return this.signedRequest(`/api/bridge/v1/sessions/${sessionId}/events`, "POST", {
      attempt,
      events,
    });
  }

  async signUploads(sessionId: string, attempt: number, entries: EvidenceEntryV1[]) {
    return this.signedRequest(`/api/bridge/v1/sessions/${sessionId}/uploads/sign`, "POST", {
      attempt,
      entries,
    });
  }

  async complete(
    sessionId: string,
    attempt: number,
    manifest: EvidenceManifestV1,
    manifestHash: string,
  ) {
    return this.signedRequest(`/api/bridge/v1/sessions/${sessionId}/complete`, "POST", {
      attempt,
      manifest,
      manifestHash,
    });
  }

  async fail(
    sessionId: string,
    attempt: number,
    errorCode: string,
    diagnostic: string,
  ) {
    return this.signedRequest(`/api/bridge/v1/sessions/${sessionId}/fail`, "POST", {
      attempt,
      errorCode,
      diagnostic,
    });
  }

  private async signedRequest(path: string, method: "GET" | "POST", payload?: unknown) {
    const token = this.accessToken;
    if (!token) throw new Error("Bridge access token is missing");
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const bodyHash = sha256(body);
    const timestamp = this.now().toISOString();
    const nonce = this.nonce();
    const signature = this.sign(requestChallenge(method, path, timestamp, nonce, bodyHash));
    return this.request(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
        "x-bridge-timestamp": timestamp,
        "x-bridge-nonce": nonce,
        "x-bridge-body-sha256": bodyHash,
        "x-bridge-signature": signature,
      },
      ...(body ? { body } : {}),
    });
  }

  private sign(challenge: string): string {
    return sign(
      null,
      Buffer.from(challenge),
      this.options.identity.privateKeyPem,
    ).toString("base64url");
  }

  private requirePaired(): PairedDevice {
    if (!this.paired) throw new Error("Bridge device has not been paired");
    return this.paired;
  }

  private async request<T = unknown>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetcher(new URL(path, this.options.baseUrl), init);
    const result = (await response.json()) as T | { error?: { code?: string; message?: string } };
    if (!response.ok) {
      const error = (result as { error?: { code?: string; message?: string } }).error;
      throw new Error(`${error?.code ?? "bridge_request_failed"}: ${error?.message ?? response.statusText}`);
    }
    return result as T;
  }
}
