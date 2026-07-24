import { randomBytes } from "node:crypto";

const clone = (value) => structuredClone(value);

export class CaptureProtocolError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "CaptureProtocolError";
    this.code = code;
  }
}

function assertSegment(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new CaptureProtocolError("INVALID_OBJECT_KEY", `${label} is unsafe`);
  }
}

export function captureObjectKey({
  workspaceId,
  sessionId,
  attempt,
  disposition,
  nodeId,
  filename,
}) {
  assertSegment(workspaceId, "workspaceId");
  assertSegment(sessionId, "sessionId");
  assertSegment(nodeId, "nodeId");
  assertSegment(filename, "filename");
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new CaptureProtocolError("INVALID_ATTEMPT", "attempt must be positive");
  }
  if (disposition !== "quarantine" && disposition !== "final") {
    throw new CaptureProtocolError(
      "INVALID_DISPOSITION",
      "disposition must be quarantine or final"
    );
  }
  return `workspaces/${workspaceId}/capture-sessions/${sessionId}/attempt-${attempt}/${disposition}/${nodeId}/${filename}`;
}

export class CaptureJobRepository {
  #jobs = new Map();

  create(input) {
    const current = this.#jobs.get(input.id);
    if (current && input.attempt <= current.currentAttempt) {
      throw new CaptureProtocolError(
        "ATTEMPT_CONFLICT",
        "attempt must advance the current attempt"
      );
    }
    const job = {
      id: input.id,
      workspaceId: input.workspaceId,
      captureSessionId: input.captureSessionId,
      imageDigest: input.imageDigest,
      currentAttempt: input.attempt,
      status: "created",
      leaseToken: null,
      leaseExpiresAt: null,
      manifestHash: null,
    };
    this.#jobs.set(input.id, job);
    return clone(job);
  }

  lease({ jobId, attempt, ttlMs }) {
    const job = this.#current(jobId, attempt);
    if (!Number.isInteger(ttlMs) || ttlMs < 1) {
      throw new CaptureProtocolError("INVALID_LEASE", "ttlMs must be positive");
    }
    const leaseToken = randomBytes(32).toString("hex");
    job.leaseToken = leaseToken;
    job.leaseExpiresAt = Date.now() + ttlMs;
    job.status = "leased";
    return { ...clone(job), leaseToken };
  }

  expireLease(jobId, leaseToken) {
    const job = this.#jobs.get(jobId);
    if (!job || job.leaseToken !== leaseToken) {
      throw new CaptureProtocolError("LEASE_LOST", "lease token is not current");
    }
    job.status = "expired";
    job.leaseExpiresAt = 0;
  }

  complete({ jobId, attempt, leaseToken, manifestHash }) {
    const job = this.#current(jobId, attempt);
    if (
      job.leaseToken !== leaseToken ||
      job.status === "expired" ||
      (job.leaseExpiresAt ?? 0) <= Date.now()
    ) {
      throw new CaptureProtocolError("LEASE_LOST", "lease is not current");
    }
    if (!/^[0-9a-f]{64}$/.test(manifestHash)) {
      throw new CaptureProtocolError("INVALID_MANIFEST", "manifest hash is invalid");
    }
    job.status = "completed";
    job.manifestHash = manifestHash;
    return clone(job);
  }

  #current(jobId, attempt) {
    const job = this.#jobs.get(jobId);
    if (!job) throw new CaptureProtocolError("JOB_NOT_FOUND", "job not found");
    if (job.currentAttempt !== attempt) {
      throw new CaptureProtocolError(
        "STALE_ATTEMPT",
        `attempt ${attempt} is fenced by ${job.currentAttempt}`
      );
    }
    return job;
  }
}

function expectedPrefix(manifest, disposition) {
  return `workspaces/${manifest.workspaceId}/capture-sessions/${manifest.captureSessionId}/attempt-${manifest.attempt}/${disposition}/`;
}

export async function verifyEvidenceManifest(manifest, objectStore) {
  if (manifest?.schemaVersion !== "evidence-manifest/v1") {
    throw new CaptureProtocolError("INVALID_MANIFEST", "schemaVersion is invalid");
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new CaptureProtocolError("INVALID_MANIFEST", "entries are required");
  }
  for (const entry of manifest.entries) {
    const disposition =
      entry.redactionStatus === "passed" ? "final" : "quarantine";
    if (!entry.r2Key.startsWith(expectedPrefix(manifest, disposition))) {
      throw new CaptureProtocolError(
        "OBJECT_SCOPE_MISMATCH",
        `${entry.r2Key} is outside the current attempt ${disposition} prefix`
      );
    }
    const head = await objectStore.head(entry.r2Key);
    if (!head) {
      throw new CaptureProtocolError("ASSET_MISSING", entry.r2Key);
    }
    if (
      head.bytes !== entry.bytes ||
      head.sha256 !== entry.sha256 ||
      head.mimeType !== entry.mimeType
    ) {
      throw new CaptureProtocolError(
        "ASSET_METADATA_MISMATCH",
        entry.r2Key
      );
    }
  }
  return clone(manifest);
}
