import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  randomInt,
  timingSafeEqual,
  verify,
} from "node:crypto";
import {
  evidenceEntryV1Schema,
  evidenceManifestV1Schema,
  type EvidenceEntryV1,
  type EvidenceManifestV1,
} from "@purpleink/ego-capture-bridge/protocol";

const PAIRING_TTL_MS = 5 * 60_000;
const TOKEN_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 30 * 60_000;
const SESSION_MAX_MS = 60 * 60_000;
const DISCONNECT_AFTER_MS = 30_000;
const UPLOAD_TTL_SECONDS = 5 * 60;

type CaptureSessionState =
  | "created"
  | "claimed"
  | "running"
  | "uploading"
  | "awaiting_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

type PairingCode = {
  codeHash: string;
  workspaceId: string;
  userId: string;
  expiresAt: Date;
  consumedAt?: Date;
};

type CaptureDevice = {
  id: string;
  workspaceId: string;
  userId: string;
  publicKey: string;
  credentialHash: string;
  bridgeVersion: string;
  egoVersion: string;
  label: string;
  revokedAt?: Date;
  lastSeenAt: Date;
  nonces: Set<string>;
};

type CaptureEventInput = {
  seq: number;
  type: string;
  payload: unknown;
};

type CaptureSession = {
  id: string;
  workspaceId: string;
  productId: string;
  releaseId?: string;
  deviceId: string;
  kind: "discovery" | "capture";
  state: CaptureSessionState;
  connectivity: "connected" | "disconnected";
  attempt: number;
  runId: string;
  flowVersionId: string;
  allowedOrigins: string[];
  createdAt: Date;
  expiresAt: Date;
  hardExpiresAt: Date;
  claimedAt?: Date;
  lastHeartbeatAt?: Date;
  currentNodeId?: string;
  currentActionId?: string;
  lastEventSeq: number;
  events: Map<number, string>;
  uploadIntents: Map<string, EvidenceEntryV1>;
  manifestHash?: string;
  errorCode?: string;
  diagnostic?: string;
};

type TokenClaims = {
  deviceId: string;
  workspaceId: string;
  issuedAt: number;
  expiresAt: number;
  tokenId: string;
};

export interface BridgeUploadSigner {
  signPut(input: {
    key: string;
    bytes: number;
    sha256: string;
    mimeType: string;
    expiresInSeconds: number;
  }): Promise<{
    url: string;
    headers: Record<string, string>;
    expiresAt: string;
  }>;
}

export interface BridgeObjectStore {
  head(key: string): Promise<{
    bytes: number;
    sha256: string;
    mimeType: string;
  } | null>;
}

type BridgeServiceOptions = {
  now?: () => Date;
  tokenSecret: Buffer;
  uploadSigner: BridgeUploadSigner;
  objectStore: BridgeObjectStore;
};

export class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
    .join(",")}}`;
}

export function deviceTokenChallenge(
  deviceId: string,
  timestamp: string,
  nonce: string,
): string {
  return `purpleink-bridge-token/v1\n${deviceId}\n${timestamp}\n${nonce}`;
}

export function deviceRequestChallenge(
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

function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isTerminal(state: CaptureSessionState): boolean {
  return ["completed", "failed", "cancelled", "expired"].includes(state);
}

export class BridgeService {
  private readonly pairingCodes = new Map<string, PairingCode>();
  private readonly devices = new Map<string, CaptureDevice>();
  private readonly sessions = new Map<string, CaptureSession>();
  private readonly now: () => Date;

  constructor(private readonly options: BridgeServiceOptions) {
    if (options.tokenSecret.length < 32) {
      throw new Error("Bridge token secret must be at least 32 bytes");
    }
    this.now = options.now ?? (() => new Date());
  }

  issuePairingCode(input: { workspaceId: string; userId: string }): {
    code: string;
    expiresAt: string;
  } {
    let code: string;
    do {
      code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    } while (this.pairingCodes.has(sha256Hex(code)));
    const expiresAt = new Date(this.now().getTime() + PAIRING_TTL_MS);
    this.pairingCodes.set(sha256Hex(code), {
      codeHash: sha256Hex(code),
      workspaceId: input.workspaceId,
      userId: input.userId,
      expiresAt,
    });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  async pair(input: {
    code: string;
    publicKey: string;
    bridgeVersion: string;
    egoVersion: string;
    label: string;
  }): Promise<{
    deviceId: string;
    workspaceId: string;
    deviceCredential: string;
  }> {
    const pairing = this.pairingCodes.get(sha256Hex(input.code));
    if (
      !pairing ||
      pairing.consumedAt ||
      pairing.expiresAt.getTime() <= this.now().getTime()
    ) {
      throw new BridgeError(
        "pairing_code_invalid",
        "Pairing code is invalid, expired, or already used",
        401,
      );
    }
    let publicKey: ReturnType<typeof createPublicKey>;
    try {
      publicKey = createPublicKey(input.publicKey);
    } catch {
      throw new BridgeError("public_key_invalid", "Device public key is invalid");
    }
    if (publicKey.asymmetricKeyType !== "ed25519") {
      throw new BridgeError("public_key_invalid", "Device key must use Ed25519");
    }
    const deviceId = crypto.randomUUID();
    const deviceCredential = randomBytes(32).toString("base64url");
    const now = this.now();
    pairing.consumedAt = now;
    this.devices.set(deviceId, {
      id: deviceId,
      workspaceId: pairing.workspaceId,
      userId: pairing.userId,
      publicKey: input.publicKey,
      credentialHash: sha256Hex(deviceCredential),
      bridgeVersion: input.bridgeVersion,
      egoVersion: input.egoVersion,
      label: input.label,
      lastSeenAt: now,
      nonces: new Set(),
    });
    return { deviceId, workspaceId: pairing.workspaceId, deviceCredential };
  }

  createAccessToken(input: {
    deviceId: string;
    deviceCredential: string;
    timestamp: string;
    nonce: string;
    signature: string;
  }): { accessToken: string; expiresAt: string } {
    const device = this.activeDevice(input.deviceId);
    if (!equalSecret(device.credentialHash, sha256Hex(input.deviceCredential))) {
      throw new BridgeError("device_auth_invalid", "Device authentication failed", 401);
    }
    const timestamp = new Date(input.timestamp);
    if (
      Number.isNaN(timestamp.getTime()) ||
      Math.abs(this.now().getTime() - timestamp.getTime()) > PAIRING_TTL_MS
    ) {
      throw new BridgeError("device_signature_stale", "Device signature timestamp is stale", 401);
    }
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(input.nonce) || device.nonces.has(input.nonce)) {
      throw new BridgeError("device_signature_replayed", "Device signature nonce was replayed", 401);
    }
    const valid = verify(
      null,
      Buffer.from(deviceTokenChallenge(input.deviceId, input.timestamp, input.nonce)),
      device.publicKey,
      Buffer.from(input.signature, "base64url"),
    );
    if (!valid) {
      throw new BridgeError("device_signature_invalid", "Device signature is invalid", 401);
    }
    device.nonces.add(input.nonce);
    device.lastSeenAt = this.now();
    const issuedAt = this.now().getTime();
    const claims: TokenClaims = {
      deviceId: device.id,
      workspaceId: device.workspaceId,
      issuedAt,
      expiresAt: issuedAt + TOKEN_TTL_MS,
      tokenId: crypto.randomUUID(),
    };
    return {
      accessToken: this.signToken(claims),
      expiresAt: new Date(claims.expiresAt).toISOString(),
    };
  }

  authenticate(token: string): TokenClaims {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) {
      throw new BridgeError("token_invalid", "Access token is invalid", 401);
    }
    const expected = createHmac("sha256", this.options.tokenSecret)
      .update(payload)
      .digest("base64url");
    if (!equalSecret(expected, signature)) {
      throw new BridgeError("token_invalid", "Access token signature is invalid", 401);
    }
    let claims: TokenClaims;
    try {
      claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenClaims;
    } catch {
      throw new BridgeError("token_invalid", "Access token payload is invalid", 401);
    }
    if (claims.expiresAt <= this.now().getTime()) {
      throw new BridgeError("token_expired", "Access token has expired", 401);
    }
    const device = this.activeDevice(claims.deviceId);
    if (device.workspaceId !== claims.workspaceId) {
      throw new BridgeError("token_invalid", "Access token workspace is invalid", 401);
    }
    return claims;
  }

  authenticateRequest(input: {
    token: string;
    method: string;
    path: string;
    timestamp: string;
    nonce: string;
    bodyHash: string;
    signature: string;
  }): TokenClaims {
    const claims = this.authenticate(input.token);
    const device = this.activeDevice(claims.deviceId);
    const timestamp = new Date(input.timestamp);
    if (
      Number.isNaN(timestamp.getTime()) ||
      Math.abs(this.now().getTime() - timestamp.getTime()) > PAIRING_TTL_MS
    ) {
      throw new BridgeError("request_signature_stale", "Request signature timestamp is stale", 401);
    }
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(input.nonce) || device.nonces.has(input.nonce)) {
      throw new BridgeError("request_signature_replayed", "Request signature nonce was replayed", 401);
    }
    if (!/^[0-9a-f]{64}$/.test(input.bodyHash)) {
      throw new BridgeError("request_body_hash_invalid", "Request body hash is invalid", 401);
    }
    const valid = verify(
      null,
      Buffer.from(
        deviceRequestChallenge(
          input.method,
          input.path,
          input.timestamp,
          input.nonce,
          input.bodyHash,
        ),
      ),
      device.publicKey,
      Buffer.from(input.signature, "base64url"),
    );
    if (!valid) {
      throw new BridgeError("request_signature_invalid", "Request signature is invalid", 401);
    }
    device.nonces.add(input.nonce);
    device.lastSeenAt = this.now();
    return claims;
  }

  createSession(input: {
    id?: string;
    workspaceId: string;
    productId: string;
    releaseId?: string;
    deviceId: string;
    kind: "discovery" | "capture";
    attempt: number;
    runId: string;
    flowVersionId: string;
    allowedOrigins: string[];
  }) {
    const device = this.activeDevice(input.deviceId);
    if (device.workspaceId !== input.workspaceId) {
      throw new BridgeError("workspace_mismatch", "Device belongs to another workspace", 404);
    }
    const duplicate = [...this.sessions.values()].find(
      (session) =>
        session.workspaceId === input.workspaceId &&
        session.productId === input.productId &&
        session.releaseId === input.releaseId &&
        session.kind === input.kind &&
        !isTerminal(session.state),
    );
    if (duplicate) return this.publicSession(duplicate);
    const createdAt = this.now();
    const session: CaptureSession = {
      id: input.id ?? crypto.randomUUID(),
      workspaceId: input.workspaceId,
      productId: input.productId,
      ...(input.releaseId ? { releaseId: input.releaseId } : {}),
      deviceId: input.deviceId,
      kind: input.kind,
      state: "created",
      connectivity: "disconnected",
      attempt: input.attempt,
      runId: input.runId,
      flowVersionId: input.flowVersionId,
      allowedOrigins: [...input.allowedOrigins],
      createdAt,
      expiresAt: new Date(createdAt.getTime() + SESSION_TTL_MS),
      hardExpiresAt: new Date(createdAt.getTime() + SESSION_MAX_MS),
      lastEventSeq: 0,
      events: new Map(),
      uploadIntents: new Map(),
    };
    this.sessions.set(session.id, session);
    return this.publicSession(session);
  }

  nextSession(token: string) {
    const claims = this.authenticate(token);
    const session = [...this.sessions.values()].find(
      (candidate) =>
        candidate.deviceId === claims.deviceId && candidate.state === "created",
    );
    return session ? this.publicSession(session) : null;
  }

  claim(token: string, sessionId: string, attempt: number) {
    const session = this.authorizeSession(token, sessionId, attempt);
    if (session.state === "expired") {
      throw new BridgeError("session_expired", "Capture session has expired", 410);
    }
    if (session.state === "created") {
      session.state = "claimed";
      session.claimedAt = this.now();
      session.lastHeartbeatAt = this.now();
      session.connectivity = "connected";
    } else if (!['claimed', 'running', 'awaiting_user', 'uploading'].includes(session.state)) {
      throw new BridgeError("session_not_claimable", `Session is ${session.state}`, 409);
    }
    return this.publicSession(session);
  }

  heartbeat(
    token: string,
    sessionId: string,
    attempt: number,
    input: {
      reportedState: "running" | "awaiting_user";
      resumeConfirmed?: boolean;
      currentNodeId?: string;
      currentActionId?: string;
    },
  ) {
    const session = this.authorizeSession(token, sessionId, attempt);
    if (session.state === "created") {
      throw new BridgeError("session_not_claimed", "Capture session is not claimed", 409);
    }
    if (isTerminal(session.state)) {
      throw new BridgeError("session_terminal", `Session is ${session.state}`, 409);
    }
    if (
      session.state === "awaiting_user" &&
      input.reportedState === "running" &&
      input.resumeConfirmed !== true
    ) {
      throw new BridgeError(
        "resume_confirmation_required",
        "Local resume confirmation is required",
        409,
      );
    }
    session.state = input.reportedState;
    session.lastHeartbeatAt = this.now();
    session.connectivity = "connected";
    session.expiresAt = new Date(
      Math.min(this.now().getTime() + SESSION_TTL_MS, session.hardExpiresAt.getTime()),
    );
    if (input.currentNodeId === undefined) delete session.currentNodeId;
    else session.currentNodeId = input.currentNodeId;
    if (input.currentActionId === undefined) delete session.currentActionId;
    else session.currentActionId = input.currentActionId;
    return this.publicSession(session);
  }

  appendEvents(
    token: string,
    sessionId: string,
    attempt: number,
    events: CaptureEventInput[],
  ): { accepted: number; lastEventSeq: number } {
    const session = this.authorizeSession(token, sessionId, attempt);
    let accepted = 0;
    for (const event of events) {
      if (!Number.isSafeInteger(event.seq) || event.seq <= 0) {
        throw new BridgeError("event_seq_invalid", "Event seq must be a positive integer");
      }
      const serialized = stableJson({ type: event.type, payload: event.payload });
      const existing = session.events.get(event.seq);
      if (existing) {
        if (existing !== serialized) {
          throw new BridgeError("event_seq_conflict", "Duplicate event seq conflicts with stored event", 409);
        }
        continue;
      }
      if (event.seq !== session.lastEventSeq + 1) {
        throw new BridgeError("event_seq_gap", "Event seq must be contiguous", 409);
      }
      session.events.set(event.seq, serialized);
      session.lastEventSeq = event.seq;
      accepted += 1;
    }
    return { accepted, lastEventSeq: session.lastEventSeq };
  }

  async signUploads(
    token: string,
    sessionId: string,
    attempt: number,
    rawEntries: unknown[],
  ) {
    const session = this.authorizeSession(token, sessionId, attempt);
    if (!['claimed', 'running', 'uploading'].includes(session.state)) {
      throw new BridgeError("session_not_uploadable", `Session is ${session.state}`, 409);
    }
    const entries = rawEntries.map((entry) => evidenceEntryV1Schema.parse(entry));
    entries.forEach((entry) => this.assertManifestEntry(session, entry));
    session.state = "uploading";
    return Promise.all(
      entries.map(async (entry) => {
        session.uploadIntents.set(entry.r2Key, entry);
        return this.options.uploadSigner.signPut({
          key: entry.r2Key,
          bytes: entry.bytes,
          sha256: entry.sha256,
          mimeType: entry.mimeType,
          expiresInSeconds: UPLOAD_TTL_SECONDS,
        });
      }),
    );
  }

  async complete(
    token: string,
    sessionId: string,
    attempt: number,
    rawManifest: unknown,
    manifestHash: string,
  ) {
    const session = this.authorizeSession(token, sessionId, attempt, true);
    const manifest = evidenceManifestV1Schema.parse(rawManifest);
    const calculatedHash = sha256Hex(stableJson(manifest));
    if (calculatedHash !== manifestHash) {
      throw new BridgeError("manifest_hash_invalid", "Manifest hash does not match content");
    }
    if (session.state === "completed") {
      if (session.manifestHash !== manifestHash) {
        throw new BridgeError("manifest_conflict", "Session already completed with another manifest", 409);
      }
      return this.publicSession(session);
    }
    if (manifest.captureSessionId !== session.id || manifest.runId !== session.runId || manifest.flowVersionId !== session.flowVersionId) {
      throw new BridgeError("manifest_ownership_invalid", "Manifest does not belong to this capture session", 403);
    }
    const keys = new Set<string>();
    for (const entry of manifest.entries) {
      this.assertManifestEntry(session, entry);
      if (entry.redactionStatus !== "passed") {
        throw new BridgeError("manifest_redaction_failed", "Every manifest entry must pass redaction");
      }
      if (keys.has(entry.r2Key)) {
        throw new BridgeError("manifest_key_duplicate", "Manifest R2 keys must be unique");
      }
      keys.add(entry.r2Key);
      const intent = session.uploadIntents.get(entry.r2Key);
      if (!intent || stableJson(intent) !== stableJson(entry)) {
        throw new BridgeError("upload_intent_missing", "Manifest entry has no matching signed upload", 403);
      }
      const object = await this.options.objectStore.head(entry.r2Key);
      if (
        !object ||
        object.bytes !== entry.bytes ||
        object.sha256 !== entry.sha256 ||
        object.mimeType !== entry.mimeType
      ) {
        throw new BridgeError("upload_verification_failed", "Uploaded object hash, size, or MIME does not match", 422);
      }
    }
    this.assertRequiredEvidence(manifest);
    session.state = "completed";
    session.manifestHash = manifestHash;
    return this.publicSession(session);
  }

  fail(
    token: string,
    sessionId: string,
    attempt: number,
    input: { errorCode: string; diagnostic: string },
  ) {
    const session = this.authorizeSession(token, sessionId, attempt);
    if (isTerminal(session.state)) {
      if (
        session.state === "failed" &&
        session.errorCode === input.errorCode &&
        session.diagnostic === input.diagnostic.slice(0, 2_000)
      ) {
        return this.publicSession(session);
      }
      throw new BridgeError("session_terminal", `Session is ${session.state}`, 409);
    }
    if (!/^[a-z][a-z0-9_]{2,63}$/.test(input.errorCode)) {
      throw new BridgeError("error_code_invalid", "Failure error code is invalid");
    }
    if (/cookie|password|token|authorization|localstorage|profile/i.test(input.diagnostic)) {
      throw new BridgeError("diagnostic_sensitive", "Failure diagnostic contains a sensitive term");
    }
    session.state = "failed";
    session.errorCode = input.errorCode;
    session.diagnostic = input.diagnostic.slice(0, 2_000);
    return this.publicSession(session);
  }

  revokeDevice(workspaceId: string, deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (!device || device.workspaceId !== workspaceId) {
      throw new BridgeError("device_not_found", "Device not found", 404);
    }
    device.revokedAt = this.now();
    for (const session of this.sessions.values()) {
      if (session.deviceId === deviceId && !isTerminal(session.state)) {
        session.state = "cancelled";
      }
    }
  }

  sweepConnectivity(): void {
    const now = this.now().getTime();
    for (const session of this.sessions.values()) {
      if (
        !isTerminal(session.state) &&
        session.lastHeartbeatAt &&
        now - session.lastHeartbeatAt.getTime() > DISCONNECT_AFTER_MS
      ) {
        session.connectivity = "disconnected";
      }
    }
  }

  expireSessions(): void {
    const now = this.now().getTime();
    for (const session of this.sessions.values()) {
      if (!isTerminal(session.state) && session.expiresAt.getTime() <= now) {
        session.state = "expired";
        session.connectivity = "disconnected";
      }
    }
  }

  getSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new BridgeError("session_not_found", "Capture session not found", 404);
    return this.publicSession(session);
  }

  private signToken(claims: TokenClaims): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", this.options.tokenSecret)
      .update(payload)
      .digest("base64url");
    return `${payload}.${signature}`;
  }

  private activeDevice(deviceId: string): CaptureDevice {
    const device = this.devices.get(deviceId);
    if (!device) throw new BridgeError("device_not_found", "Capture device not found", 401);
    if (device.revokedAt) throw new BridgeError("device_revoked", "Capture device is revoked", 401);
    return device;
  }

  private authorizeSession(
    token: string,
    sessionId: string,
    attempt: number,
    allowCompleted = false,
  ): CaptureSession {
    const claims = this.authenticate(token);
    const session = this.sessions.get(sessionId);
    if (
      !session ||
      session.workspaceId !== claims.workspaceId ||
      session.deviceId !== claims.deviceId
    ) {
      throw new BridgeError("session_not_found", "Capture session not found", 404);
    }
    if (session.attempt !== attempt) {
      throw new BridgeError("attempt_mismatch", "Capture session attempt is stale", 409);
    }
    if (!isTerminal(session.state) && session.expiresAt.getTime() <= this.now().getTime()) {
      session.state = "expired";
      session.connectivity = "disconnected";
    }
    if (!allowCompleted && session.state === "expired") {
      throw new BridgeError("session_expired", "Capture session has expired", 410);
    }
    if (allowCompleted && session.state === "expired") {
      throw new BridgeError("session_expired", "Capture session has expired", 410);
    }
    return session;
  }

  private assertManifestEntry(session: CaptureSession, entry: EvidenceEntryV1): void {
    const prefix = `workspaces/${session.workspaceId}/capture-sessions/${session.id}/attempt-${session.attempt}/`;
    if (
      !entry.r2Key.startsWith(prefix) ||
      entry.r2Key.includes("..") ||
      entry.r2Key.includes("\\") ||
      entry.r2Key.includes("//")
    ) {
      throw new BridgeError("r2_key_invalid", "Manifest R2 key is outside the session prefix", 403);
    }
    const allowedMimeTypes: Record<EvidenceEntryV1["kind"], readonly string[]> = {
      before_screenshot: ["image/png", "image/jpeg", "image/webp"],
      result_screenshot: ["image/png", "image/jpeg", "image/webp"],
      node_clip: ["video/webm", "video/mp4"],
      assertion_report: ["application/json"],
      dom_summary: ["application/json"],
      trace: ["application/json", "application/zip"],
      diagnostic: ["application/json", "text/plain"],
    };
    if (!allowedMimeTypes[entry.kind].includes(entry.mimeType)) {
      throw new BridgeError("mime_type_invalid", `MIME is invalid for ${entry.kind}`);
    }
  }

  private assertRequiredEvidence(manifest: EvidenceManifestV1): void {
    const required = new Set([
      "result_screenshot",
      "node_clip",
      "assertion_report",
      "dom_summary",
    ]);
    const byNode = new Map<string, Set<string>>();
    for (const entry of manifest.entries) {
      const kinds = byNode.get(entry.nodeId) ?? new Set<string>();
      kinds.add(entry.kind);
      byNode.set(entry.nodeId, kinds);
    }
    for (const kinds of byNode.values()) {
      for (const kind of required) {
        if (!kinds.has(kind)) {
          throw new BridgeError("evidence_incomplete", `Node evidence is missing ${kind}`);
        }
      }
    }
  }

  private publicSession(session: CaptureSession) {
    return {
      id: session.id,
      workspaceId: session.workspaceId,
      productId: session.productId,
      ...(session.releaseId ? { releaseId: session.releaseId } : {}),
      deviceId: session.deviceId,
      kind: session.kind,
      state: session.state,
      connectivity: session.connectivity,
      attempt: session.attempt,
      runId: session.runId,
      flowVersionId: session.flowVersionId,
      allowedOrigins: [...session.allowedOrigins],
      expiresAt: session.expiresAt.toISOString(),
      lastEventSeq: session.lastEventSeq,
      ...(session.manifestHash ? { manifestHash: session.manifestHash } : {}),
      ...(session.errorCode ? { errorCode: session.errorCode } : {}),
    };
  }
}
