import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { contentHash, parseProductFlowV1 } from "@purpleink/product-flow";
import { verifyEvidenceManifest } from "@purpleink/playwright-capture-worker/protocol";

type SqlClient = ReturnType<typeof postgres>;
type ObjectStore = {
  signPut(input: {
    key: string;
    bytes: number;
    sha256: string;
    mimeType: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; headers: Record<string, string>; expiresAt: string }>;
  head(key: string): Promise<{
    bytes: number;
    sha256: string;
    mimeType: string;
  } | null>;
};

type ManifestEntry = {
  nodeId: string;
  actionId?: string;
  kind: string;
  r2Key: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  redactionStatus: "passed" | "blocked" | "needs_review";
};

type EvidenceManifest = {
  schemaVersion: string;
  workspaceId: string;
  captureSessionId: string;
  jobId: string;
  attempt: number;
  runId: string;
  flowVersionId: string;
  imageDigest: string;
  actionJournalHash: string;
  entries: ManifestEntry[];
  candidateFlow?: unknown;
};

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const CAPTURE_LEASE_RENEWAL_MS = 120_000;

export class CaptureControlError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "CaptureControlError";
  }
}

export class PostgresCaptureControlPlane {
  constructor(
    private readonly sql: SqlClient,
    private readonly objectStore: ObjectStore
  ) {}

  async retryCapture(input: {
    workspaceId: string;
    releaseId: string;
    captureSessionId: string;
    jobId: string;
    expectedRevision: number;
    idempotencyKey: string;
    imageDigest: string;
    region: string;
    payload: unknown;
  }) {
    if (!input.idempotencyKey) {
      throw new CaptureControlError("IDEMPOTENCY_KEY_REQUIRED", "retry requires an idempotency key");
    }
    const fingerprint = JSON.stringify({
      command: "retry_capture",
      workspaceId: input.workspaceId,
      releaseId: input.releaseId,
      captureSessionId: input.captureSessionId,
      jobId: input.jobId,
      expectedRevision: input.expectedRevision,
      imageDigest: input.imageDigest,
      region: input.region,
      payload: input.payload,
    });
    return this.sql.begin(async (tx) => {
      const existing = await tx`
        select fingerprint,result from command_receipts
        where workspace_id=${input.workspaceId} and idempotency_key=${input.idempotencyKey}
      `;
      if (existing[0]) {
        if (existing[0].fingerprint !== fingerprint) {
          throw new CaptureControlError("IDEMPOTENCY_CONFLICT", "idempotency key belongs to another command");
        }
        return existing[0].result;
      }
      const releases = await tx`
        select lifecycle,stage,failed_from_stage,revision
        from releases
        where workspace_id=${input.workspaceId} and id=${input.releaseId}
        for update
      `;
      const release = releases[0];
      if (!release) throw new CaptureControlError("RELEASE_NOT_FOUND", "Release not found");

      const receiptAfterLock = await tx`
        select fingerprint,result from command_receipts
        where workspace_id=${input.workspaceId} and idempotency_key=${input.idempotencyKey}
      `;
      if (receiptAfterLock[0]) {
        if (receiptAfterLock[0].fingerprint !== fingerprint) {
          throw new CaptureControlError("IDEMPOTENCY_CONFLICT", "idempotency key belongs to another command");
        }
        return receiptAfterLock[0].result;
      }
      if (release.revision !== input.expectedRevision) {
        throw new CaptureControlError("REVISION_CONFLICT", `expected revision ${input.expectedRevision}, found ${release.revision}`);
      }
      if (
        release.lifecycle !== "failed" ||
        release.stage !== "capturing" ||
        release.failed_from_stage !== "capturing"
      ) {
        throw new CaptureControlError("INVALID_RELEASE_STATE", "retry_capture requires a failed capturing Release");
      }
      const sessions = await tx`
        select current_attempt from capture_sessions
        where workspace_id=${input.workspaceId} and id=${input.captureSessionId}
          and release_id=${input.releaseId} and kind='capture'
        for update
      `;
      if (!sessions[0]) {
        throw new CaptureControlError("SESSION_NOT_FOUND", "failed CaptureSession not found");
      }
      const attempt = Number(sessions[0].current_attempt) + 1;
      const runs = await tx`
        update capture_runs set status='running',finished_at=null,
          started_at=coalesce(started_at,now())
        where workspace_id=${input.workspaceId} and release_id=${input.releaseId}
          and capture_session_id=${input.captureSessionId} and status='failed'
        returning id
      `;
      if (!runs[0]) {
        throw new CaptureControlError("CAPTURE_RUN_NOT_FAILED", "retry requires a failed CaptureRun");
      }
      await tx`
        insert into capture_worker_jobs(
          id,workspace_id,capture_session_id,attempt,image_digest,region,payload
        ) values(
          ${input.jobId},${input.workspaceId},${input.captureSessionId},${attempt},
          ${input.imageDigest},${input.region},${tx.json(input.payload as postgres.JSONValue)}
        )
      `;
      await tx`
        update capture_sessions set current_job_id=${input.jobId},current_attempt=${attempt},
          state='created',connectivity='disconnected',error_code=null,diagnostic=null,updated_at=now()
        where workspace_id=${input.workspaceId} and id=${input.captureSessionId}
      `;
      const updated = await tx`
        update releases set lifecycle='active',failed_from_stage=null,
          revision=revision+1,updated_at=now()
        where workspace_id=${input.workspaceId} and id=${input.releaseId}
        returning revision
      `;
      const updatedRelease = updated[0];
      if (!updatedRelease) {
        throw new CaptureControlError("RELEASE_NOT_FOUND", "Release disappeared during retry");
      }
      const result = { jobId: input.jobId, attempt, revision: updatedRelease.revision as number };
      await tx`
        insert into command_receipts(workspace_id,release_id,idempotency_key,fingerprint,result)
        values(${input.workspaceId},${input.releaseId},${input.idempotencyKey},${fingerprint},${tx.json(result)})
      `;
      return result;
    });
  }

  async createAttempt(input: {
    id: string;
    workspaceId: string;
    captureSessionId: string;
    attempt: number;
    imageDigest: string;
    region: string;
    payload: unknown;
  }) {
    return this.sql.begin(async (tx) => {
      const sessions = await tx`
        select current_attempt from capture_sessions
        where workspace_id=${input.workspaceId} and id=${input.captureSessionId}
        for update
      `;
      if (!sessions[0]) {
        throw new CaptureControlError("SESSION_NOT_FOUND", "CaptureSession not found");
      }
      if (input.attempt <= sessions[0].current_attempt) {
        throw new CaptureControlError("ATTEMPT_CONFLICT", "attempt must advance");
      }
      await tx`
        insert into capture_worker_jobs (
          id,workspace_id,capture_session_id,attempt,image_digest,region,payload
        ) values (
          ${input.id},${input.workspaceId},${input.captureSessionId},${input.attempt},
          ${input.imageDigest},${input.region},${tx.json(input.payload as postgres.JSONValue)}
        )
      `;
      await tx`
        update capture_sessions
        set current_job_id=${input.id},current_attempt=${input.attempt},
            state='created',connectivity='disconnected',updated_at=now()
        where workspace_id=${input.workspaceId} and id=${input.captureSessionId}
      `;
      return { id: input.id, attempt: input.attempt, status: "created" };
    });
  }

  async lease(input: {
    workspaceId: string;
    jobId: string;
    attempt: number;
    ttlMs: number;
  }) {
    if (!Number.isInteger(input.ttlMs) || input.ttlMs < 1) {
      throw new CaptureControlError("INVALID_LEASE", "ttlMs must be positive");
    }
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + input.ttlMs);
    return this.sql.begin(async (tx) => {
      const jobs = await tx`
        select j.*,s.current_job_id,s.current_attempt
        from capture_worker_jobs j
        join capture_sessions s
          on s.workspace_id=j.workspace_id and s.id=j.capture_session_id
        where j.workspace_id=${input.workspaceId} and j.id=${input.jobId}
        for update of j,s
      `;
      const job = jobs[0];
      if (!job) throw new CaptureControlError("JOB_NOT_FOUND", "job not found");
      if (
        job.attempt !== input.attempt ||
        job.current_job_id !== input.jobId ||
        job.current_attempt !== input.attempt
      ) {
        throw new CaptureControlError("STALE_ATTEMPT", "attempt is fenced");
      }
      await tx`
        update capture_worker_jobs
        set status='leased',lease_token_hash=${hash(token)},
            lease_expires_at=${expiresAt},started_at=coalesce(started_at,now())
        where workspace_id=${input.workspaceId} and id=${input.jobId}
      `;
      await tx`
        update capture_sessions set state='claimed',connectivity='connected',
          claimed_at=coalesce(claimed_at,now()),last_heartbeat_at=now(),updated_at=now()
        where workspace_id=${input.workspaceId} and id=${job.capture_session_id}
      `;
      return { leaseToken: token, expiresAt: expiresAt.toISOString(), payload: job.payload };
    });
  }

  async signUploads(input: {
    workspaceId: string;
    jobId: string;
    attempt: number;
    leaseToken: string;
    entries: Array<{
      r2Key: string;
      mimeType: string;
      bytes: number;
      sha256: string;
      redactionStatus: "passed" | "blocked" | "needs_review";
    }>;
  }) {
    const job = await this.requireCurrentLease(input);
    const finalPrefix = `workspaces/${input.workspaceId}/capture-sessions/${job.capture_session_id}/attempt-${input.attempt}/`;
    const uploads = [];
    for (const entry of input.entries) {
      const disposition = entry.redactionStatus === "passed" ? "final" : "quarantine";
      if (!entry.r2Key.startsWith(`${finalPrefix}${disposition}/`)) {
        throw new CaptureControlError("OBJECT_SCOPE_MISMATCH", entry.r2Key);
      }
      const signed = await this.objectStore.signPut({
        key: entry.r2Key,
        bytes: entry.bytes,
        sha256: entry.sha256,
        mimeType: entry.mimeType,
        expiresInSeconds: 300,
      });
      await this.sql`
        insert into capture_upload_intents (
          workspace_id,session_id,attempt,r2_key,mime_type,bytes,sha256,expires_at
        ) values (
          ${input.workspaceId},${job.capture_session_id},${input.attempt},
          ${entry.r2Key},${entry.mimeType},${entry.bytes},${entry.sha256},${signed.expiresAt}
        ) on conflict (workspace_id,session_id,r2_key) do nothing
      `;
      uploads.push({ r2Key: entry.r2Key, ...signed });
    }
    return uploads;
  }

  async heartbeat(input: {
    workspaceId: string;
    jobId: string;
    attempt: number;
    leaseToken: string;
  }) {
    const job = await this.requireCurrentLease(input);
    const leaseExpiresAt = new Date(Date.now() + CAPTURE_LEASE_RENEWAL_MS);
    await this.sql.begin(async (tx) => {
      const updated = await tx`
        update capture_worker_jobs j set status='running',
          lease_expires_at=least(s.hard_expires_at,${leaseExpiresAt})
        from capture_sessions s
        where j.workspace_id=${input.workspaceId} and j.id=${input.jobId}
          and j.attempt=${input.attempt} and j.lease_token_hash=${hash(input.leaseToken)}
          and j.lease_expires_at > now() and j.status in ('leased','running','uploading')
          and s.workspace_id=j.workspace_id and s.id=j.capture_session_id
          and s.current_job_id=j.id and s.current_attempt=j.attempt
          and s.hard_expires_at > now()
        returning j.id
      `;
      if (!updated[0]) throw new CaptureControlError("STALE_ATTEMPT", "attempt lost its lease");
      await tx`
        update capture_sessions set state='running',connectivity='connected',
          expires_at=least(hard_expires_at,now()+interval '30 minutes'),
          last_heartbeat_at=now(),updated_at=now()
        where workspace_id=${input.workspaceId} and id=${job.capture_session_id}
          and current_job_id=${input.jobId} and current_attempt=${input.attempt}
      `;
    });
    return { accepted: true };
  }

  async appendEvent(input: {
    workspaceId: string;
    jobId: string;
    attempt: number;
    leaseToken: string;
    seq: number;
    eventType: string;
    payload: unknown;
  }) {
    if (!Number.isInteger(input.seq) || input.seq < 1 || !input.eventType) {
      throw new CaptureControlError("INVALID_EVENT", "event seq and type are required");
    }
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        select j.capture_session_id,j.lease_token_hash,j.lease_expires_at,
          s.current_job_id,s.current_attempt,s.last_event_seq
        from capture_worker_jobs j
        join capture_sessions s
          on s.workspace_id=j.workspace_id and s.id=j.capture_session_id
        where j.workspace_id=${input.workspaceId} and j.id=${input.jobId}
        for update of j,s
      `;
      const current = rows[0];
      if (
        !current || current.current_job_id !== input.jobId ||
        current.current_attempt !== input.attempt ||
        current.lease_token_hash !== hash(input.leaseToken) ||
        new Date(current.lease_expires_at).getTime() <= Date.now()
      ) {
        throw new CaptureControlError("STALE_ATTEMPT", "attempt is fenced or lease expired");
      }
      if (input.seq <= current.last_event_seq) {
        const existing = await tx`
          select event_type,payload from capture_session_events
          where workspace_id=${input.workspaceId}
            and session_id=${current.capture_session_id} and seq=${input.seq}
        `;
        if (
          !existing[0] || existing[0].event_type !== input.eventType ||
          (await contentHash(existing[0].payload)) !== (await contentHash(input.payload))
        ) {
          throw new CaptureControlError("EVENT_CONFLICT", "event seq belongs to different payload");
        }
        return { accepted: true, duplicate: true, seq: input.seq };
      }
      if (input.seq !== current.last_event_seq + 1) {
        throw new CaptureControlError("EVENT_SEQUENCE_GAP", "event seq must be contiguous");
      }
      await tx`
        insert into capture_session_events(workspace_id,session_id,seq,event_type,payload)
        values(${input.workspaceId},${current.capture_session_id},${input.seq},
          ${input.eventType},${tx.json(input.payload as postgres.JSONValue)})
      `;
      await tx`
        update capture_sessions set last_event_seq=${input.seq},updated_at=now()
        where workspace_id=${input.workspaceId} and id=${current.capture_session_id}
      `;
      return { accepted: true, duplicate: false, seq: input.seq };
    });
  }

  async createHandoff(input: {
    workspaceId: string;
    jobId: string;
    attempt: number;
    leaseToken: string;
    remoteControlUrl: string;
    ttlMs: number;
  }) {
    const job = await this.requireCurrentLease(input);
    let remoteUrl: URL;
    try {
      remoteUrl = new URL(input.remoteControlUrl);
    } catch {
      throw new CaptureControlError("HANDOFF_INVALID", "remoteControlUrl is invalid");
    }
    if (
      remoteUrl.protocol !== "https:" || remoteUrl.username || remoteUrl.password ||
      !Number.isInteger(input.ttlMs) || input.ttlMs < 1 || input.ttlMs > 300_000
    ) {
      throw new CaptureControlError("HANDOFF_INVALID", "handoff requires credential-free HTTPS URL and a TTL up to five minutes");
    }
    const id = randomUUID();
    const claimToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + input.ttlMs);
    await this.sql.begin(async (tx) => {
      await tx`
        update capture_handoffs set closed_at=now()
        where workspace_id=${input.workspaceId} and job_id=${input.jobId}
          and closed_at is null
      `;
      await tx`
        insert into capture_handoffs(
          id,workspace_id,job_id,attempt,token_hash,remote_control_url,expires_at
        ) values(
          ${id},${input.workspaceId},${input.jobId},${input.attempt},${hash(claimToken)},
          ${remoteUrl.toString()},${expiresAt}
        )
      `;
      const sessions = await tx`
        update capture_sessions set state='awaiting_user',updated_at=now()
        where workspace_id=${input.workspaceId} and id=${job.capture_session_id}
          and current_job_id=${input.jobId} and current_attempt=${input.attempt}
        returning id
      `;
      if (!sessions[0]) throw new CaptureControlError("STALE_ATTEMPT", "attempt is fenced");
    });
    return { id, claimToken, expiresAt: expiresAt.toISOString() };
  }

  async claimHandoff(input: {
    workspaceId: string;
    handoffId: string;
    claimToken: string;
  }) {
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        select remote_control_url,token_hash,expires_at,consumed_at,closed_at
        from capture_handoffs
        where workspace_id=${input.workspaceId} and id=${input.handoffId}
        for update
      `;
      const handoff = rows[0];
      if (
        !handoff || handoff.token_hash !== hash(input.claimToken) ||
        handoff.consumed_at || handoff.closed_at ||
        new Date(handoff.expires_at).getTime() <= Date.now()
      ) {
        throw new CaptureControlError("HANDOFF_UNAVAILABLE", "handoff is invalid, expired, consumed, or closed");
      }
      await tx`
        update capture_handoffs set consumed_at=now()
        where workspace_id=${input.workspaceId} and id=${input.handoffId}
      `;
      return { remoteControlUrl: handoff.remote_control_url as string };
    });
  }

  async closeHandoff(input: {
    workspaceId: string;
    jobId: string;
    attempt: number;
    leaseToken: string;
    handoffId: string;
  }) {
    const job = await this.requireCurrentLease(input);
    return this.sql.begin(async (tx) => {
      const handoffs = await tx`
        select id from capture_handoffs
        where workspace_id=${input.workspaceId} and id=${input.handoffId}
          and job_id=${input.jobId} and attempt=${input.attempt}
        for update
      `;
      if (!handoffs[0]) {
        throw new CaptureControlError("HANDOFF_NOT_FOUND", "handoff does not belong to the current attempt");
      }
      await tx`
        update capture_handoffs set closed_at=coalesce(closed_at,now())
        where workspace_id=${input.workspaceId} and id=${input.handoffId}
      `;
      const sessions = await tx`
        update capture_sessions set state='running',connectivity='connected',updated_at=now()
        where workspace_id=${input.workspaceId} and id=${job.capture_session_id}
          and current_job_id=${input.jobId} and current_attempt=${input.attempt}
        returning id
      `;
      if (!sessions[0]) {
        throw new CaptureControlError("STALE_ATTEMPT", "attempt is fenced");
      }
      return { closed: true, resumed: true };
    });
  }

  async getHandoffStatus(input: {
    workspaceId: string;
    jobId: string;
    attempt: number;
    leaseToken: string;
    handoffId: string;
  }) {
    const job = await this.requireCurrentLease(input);
    const rows = await this.sql`
      select h.closed_at,h.expires_at,s.state
      from capture_handoffs h
      join capture_sessions s
        on s.workspace_id=h.workspace_id and s.id=${job.capture_session_id}
      where h.workspace_id=${input.workspaceId} and h.id=${input.handoffId}
        and h.job_id=${input.jobId} and h.attempt=${input.attempt}
    `;
    const handoff = rows[0];
    if (!handoff) {
      throw new CaptureControlError("HANDOFF_NOT_FOUND", "handoff does not belong to the current attempt");
    }
    if (!handoff.closed_at && new Date(handoff.expires_at).getTime() <= Date.now()) {
      throw new CaptureControlError("HANDOFF_UNAVAILABLE", "handoff expired before Resume");
    }
    const closed = Boolean(handoff.closed_at);
    return { closed, resumed: closed && handoff.state === "running" };
  }

  async fail(input: {
    workspaceId: string;
    jobId: string;
    attempt: number;
    leaseToken: string;
    errorCode: string;
    diagnostic?: string;
  }) {
    if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(input.errorCode) || (input.diagnostic?.length ?? 0) > 2_000) {
      throw new CaptureControlError("INVALID_FAILURE", "failure requires a stable error code and bounded diagnostic");
    }
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        select j.capture_session_id,j.lease_token_hash,j.lease_expires_at,
          s.current_job_id,s.current_attempt,s.release_id
        from capture_worker_jobs j
        join capture_sessions s
          on s.workspace_id=j.workspace_id and s.id=j.capture_session_id
        where j.workspace_id=${input.workspaceId} and j.id=${input.jobId}
        for update of j,s
      `;
      const current = rows[0];
      if (
        !current || current.current_job_id !== input.jobId ||
        current.current_attempt !== input.attempt ||
        current.lease_token_hash !== hash(input.leaseToken) ||
        new Date(current.lease_expires_at).getTime() <= Date.now()
      ) {
        throw new CaptureControlError("STALE_ATTEMPT", "attempt is fenced or lease expired");
      }
      await tx`
        update capture_worker_jobs set status='failed',error_code=${input.errorCode},finished_at=now()
        where workspace_id=${input.workspaceId} and id=${input.jobId}
      `;
      await tx`
        update capture_sessions set state='failed',connectivity='disconnected',
          error_code=${input.errorCode},diagnostic=${input.diagnostic ?? null},updated_at=now()
        where workspace_id=${input.workspaceId} and id=${current.capture_session_id}
      `;
      await tx`
        update capture_runs set status='failed',finished_at=now()
        where workspace_id=${input.workspaceId}
          and capture_session_id=${current.capture_session_id}
          and status in ('pending','running')
      `;
      const releases = await tx`
        update releases set lifecycle='failed',failed_from_stage=stage,
          revision=revision+1,updated_at=now()
        where workspace_id=${input.workspaceId} and id=${current.release_id}
          and lifecycle='active' and stage='capturing'
        returning id
      `;
      if (!releases[0]) {
        throw new CaptureControlError("INVALID_RELEASE_STATE", "Capture failure requires a capturing Release");
      }
      return { accepted: true, errorCode: input.errorCode };
    });
  }

  async completeAttempt(input: {
    workspaceId: string;
    jobId: string;
    attempt: number;
    leaseToken: string;
    manifest: EvidenceManifest;
  }) {
    const rows = await this.sql`
      select s.kind
      from capture_worker_jobs j
      join capture_sessions s
        on s.workspace_id=j.workspace_id and s.id=j.capture_session_id
      where j.workspace_id=${input.workspaceId} and j.id=${input.jobId}
    `;
    if (!rows[0]) {
      throw new CaptureControlError("JOB_NOT_FOUND", "job not found");
    }
    if (rows[0].kind === "discovery") {
      return this.completeDiscovery(input);
    }
    if (rows[0].kind === "capture") {
      return this.complete(input);
    }
    throw new CaptureControlError("INVALID_SESSION_KIND", "capture session kind is unsupported");
  }

  async completeDiscovery(input: {
    workspaceId: string;
    jobId: string;
    attempt: number;
    leaseToken: string;
    manifest: EvidenceManifest;
  }) {
    const job = await this.requireCurrentLease(input, true);
    if (
      input.manifest.workspaceId !== input.workspaceId ||
      input.manifest.captureSessionId !== job.capture_session_id ||
      input.manifest.jobId !== input.jobId ||
      input.manifest.attempt !== input.attempt ||
      input.manifest.imageDigest !== job.image_digest
    ) {
      throw new CaptureControlError("MANIFEST_PROVENANCE_MISMATCH", "manifest does not identify the current discovery attempt");
    }
    let candidateFlow;
    try {
      candidateFlow = parseProductFlowV1(input.manifest.candidateFlow);
    } catch {
      throw new CaptureControlError("DISCOVERY_CANDIDATE_INVALID", "discovery callback requires a valid ProductFlow candidate");
    }
    const candidateHash = await contentHash(candidateFlow);
    const manifestHash = await contentHash(input.manifest);
    if (job.status === "completed") {
      const existing = await this.sql`
        select content_hash from evidence_manifests
        where workspace_id=${input.workspaceId}
          and session_id=${job.capture_session_id} and attempt=${input.attempt}
      `;
      if (!existing[0] || existing[0].content_hash !== manifestHash) {
        throw new CaptureControlError("COMPLETION_CONFLICT", "completed attempt has no matching manifest receipt");
      }
      const runs = await this.sql`
        select proposed_version_id from discovery_runs
        where workspace_id=${input.workspaceId} and id=${input.manifest.runId}
      `;
      return { manifestHash, discoveryRunId: input.manifest.runId, flowVersionId: runs[0]?.proposed_version_id as string };
    }
    await verifyEvidenceManifest(input.manifest, this.objectStore);
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        select j.capture_session_id,j.lease_token_hash,j.lease_expires_at,j.image_digest,
          j.status as job_status,
          s.current_job_id,s.current_attempt,s.release_id,s.product_id,s.allowed_origins,
          d.id as discovery_run_id,d.proposed_version_id,d.product_flow_id
        from capture_worker_jobs j
        join capture_sessions s
          on s.workspace_id=j.workspace_id and s.id=j.capture_session_id
        join discovery_runs d
          on d.workspace_id=s.workspace_id and d.capture_session_id=s.id
          and d.id=${input.manifest.runId}
        where j.workspace_id=${input.workspaceId} and j.id=${input.jobId}
        for update of j,s,d
      `;
      const current = rows[0];
      if (
        !current || current.current_job_id !== input.jobId ||
        current.current_attempt !== input.attempt ||
        current.lease_token_hash !== hash(input.leaseToken) ||
        (new Date(current.lease_expires_at).getTime() <= Date.now() &&
          current.job_status !== "completed") || current.proposed_version_id
      ) {
        throw new CaptureControlError("STALE_ATTEMPT", "discovery attempt is fenced or already has a proposed version");
      }
      const flows = await tx`
        select product_id from product_flows
        where workspace_id=${input.workspaceId} and id=${current.product_flow_id}
        for update
      `;
      const allowedOrigins = Array.isArray(current.allowed_origins) ? current.allowed_origins : [];
      if (
        !flows[0] || flows[0].product_id !== current.product_id ||
        candidateFlow.productId !== current.product_id ||
        candidateFlow.allowedOrigins.some((origin) => !allowedOrigins.includes(origin))
      ) {
        throw new CaptureControlError("DISCOVERY_CANDIDATE_INVALID", "candidate does not belong to the Discovery Product or allowed origins");
      }
      const existing = await tx`
        select content_hash from evidence_manifests
        where workspace_id=${input.workspaceId}
          and session_id=${current.capture_session_id} and attempt=${input.attempt}
      `;
      if (existing[0]) {
        if (existing[0].content_hash !== manifestHash) {
          throw new CaptureControlError("COMPLETION_CONFLICT", "attempt already completed with a different manifest");
        }
        return { manifestHash, discoveryRunId: current.discovery_run_id as string, flowVersionId: input.manifest.flowVersionId };
      }
      const versions = await tx`
        select coalesce(max(version),0)+1 as next_version
        from product_flow_versions
        where workspace_id=${input.workspaceId} and product_flow_id=${current.product_flow_id}
      `;
      await tx`
        insert into product_flow_versions(
          id,workspace_id,product_flow_id,version,schema_version,payload,content_hash,status
        ) values(
          ${input.manifest.flowVersionId},${input.workspaceId},${current.product_flow_id},
          ${Number(versions[0]?.next_version)},'product-flow/v1',
          ${tx.json(candidateFlow as postgres.JSONValue)},${candidateHash},'draft'
        )
      `;
      await tx`
        insert into evidence_manifests(
          workspace_id,session_id,attempt,schema_version,payload,content_hash,verified_at
        ) values(
          ${input.workspaceId},${current.capture_session_id},${input.attempt},
          'evidence-manifest/v1',${tx.json(input.manifest as postgres.JSONValue)},${manifestHash},now()
        )
      `;
      await tx`
        update discovery_runs set status='completed',proposed_version_id=${input.manifest.flowVersionId},
          clean_replay_manifest_hash=${manifestHash},
          clean_replay_worker_image_digest=${current.image_digest},clean_replay_passed_at=now(),
          updated_at=now()
        where workspace_id=${input.workspaceId} and id=${current.discovery_run_id}
      `;
      await tx`
        update capture_worker_jobs set status='completed',finished_at=now()
        where workspace_id=${input.workspaceId} and id=${input.jobId}
      `;
      await tx`
        update capture_sessions set state='completed',manifest_hash=${manifestHash},
          connectivity='disconnected',updated_at=now()
        where workspace_id=${input.workspaceId} and id=${current.capture_session_id}
      `;
      const releases = await tx`
        update releases set stage='flow_review',revision=revision+1,updated_at=now()
        where workspace_id=${input.workspaceId} and id=${current.release_id}
          and lifecycle='active' and stage='flow_discovering'
        returning id
      `;
      if (!releases[0]) {
        throw new CaptureControlError("INVALID_RELEASE_STATE", "Discovery completion requires a discovering Release");
      }
      return { manifestHash, discoveryRunId: current.discovery_run_id as string, flowVersionId: input.manifest.flowVersionId };
    });
  }

  async complete(input: {
    workspaceId: string;
    jobId: string;
    attempt: number;
    leaseToken: string;
    manifest: EvidenceManifest;
  }) {
    const job = await this.requireCurrentLease(input, true);
    if (
      input.manifest.workspaceId !== input.workspaceId ||
      input.manifest.captureSessionId !== job.capture_session_id ||
      input.manifest.jobId !== input.jobId ||
      input.manifest.attempt !== input.attempt ||
      input.manifest.imageDigest !== job.image_digest
    ) {
      throw new CaptureControlError("MANIFEST_PROVENANCE_MISMATCH", "manifest does not identify the current attempt");
    }
    const manifestHash = await contentHash(input.manifest);
    if (job.status === "completed") {
      const existing = await this.sql`
        select content_hash from evidence_manifests
        where workspace_id=${input.workspaceId}
          and session_id=${job.capture_session_id} and attempt=${input.attempt}
      `;
      if (!existing[0] || existing[0].content_hash !== manifestHash) {
        throw new CaptureControlError("COMPLETION_CONFLICT", "completed attempt has no matching manifest receipt");
      }
      const persistedEvidence = await this.sql`
        select ne.id
        from node_evidence ne
        where ne.workspace_id=${input.workspaceId}
          and ne.manifest->>'manifestHash'=${manifestHash}
        order by ne.id
      `;
      return {
        manifestHash,
        nodeEvidenceIds: persistedEvidence.map(({ id }) => id as string),
      };
    }
    await verifyEvidenceManifest(input.manifest, this.objectStore);
    return this.sql.begin(async (tx) => {
      const current = await tx`
        select j.capture_session_id,s.product_id,s.release_id,s.current_job_id,
               s.current_attempt,j.lease_token_hash,j.lease_expires_at,
               j.status as job_status
        from capture_worker_jobs j
        join capture_sessions s on s.workspace_id=j.workspace_id and s.id=j.capture_session_id
        join capture_runs cr on cr.workspace_id=s.workspace_id
          and cr.capture_session_id=s.id and cr.id=${input.manifest.runId}
        where j.workspace_id=${input.workspaceId} and j.id=${input.jobId}
        for update of j,s
      `;
      const locked = current[0];
      if (
        !locked || locked.current_job_id !== input.jobId ||
        locked.current_attempt !== input.attempt ||
        locked.lease_token_hash !== hash(input.leaseToken) ||
        (new Date(locked.lease_expires_at).getTime() <= Date.now() &&
          locked.job_status !== "completed")
      ) {
        throw new CaptureControlError("STALE_ATTEMPT", "attempt lost its lease");
      }
      const existing = await tx`
        select content_hash from evidence_manifests
        where workspace_id=${input.workspaceId}
          and session_id=${locked.capture_session_id} and attempt=${input.attempt}
      `;
      if (existing[0]) {
        if (existing[0].content_hash !== manifestHash) {
          throw new CaptureControlError("COMPLETION_CONFLICT", "attempt already completed with a different manifest");
        }
        const persistedEvidence = await tx`
          select ne.id
          from node_evidence ne
          where ne.workspace_id=${input.workspaceId}
            and ne.manifest->>'manifestHash'=${manifestHash}
          order by ne.id
        `;
        return {
          manifestHash,
          nodeEvidenceIds: persistedEvidence.map(({ id }) => id as string),
        };
      }
      await tx`
        insert into evidence_manifests (
          workspace_id,session_id,attempt,schema_version,payload,content_hash,verified_at
        ) values (
          ${input.workspaceId},${locked.capture_session_id},${input.attempt},
          'evidence-manifest/v1',${tx.json(input.manifest as postgres.JSONValue)},${manifestHash},now()
        )
      `;
      const nodeEvidenceIds: string[] = [];
      const evidenceKinds = new Set(["result_screenshot", "node_clip", "assertion_report", "dom_summary"]);
      for (const entry of input.manifest.entries) {
        if (entry.redactionStatus !== "passed" || !evidenceKinds.has(String(entry.kind))) continue;
        const executions = await tx`
          insert into node_executions (
            workspace_id,capture_run_id,node_id,status,started_at,finished_at
          ) values (
            ${input.workspaceId},${input.manifest.runId},${entry.nodeId},'passed',now(),now()
          ) on conflict (workspace_id,capture_run_id,node_id)
          do update set status='passed',finished_at=now()
          returning id
        `;
        const sourceAssetId = randomUUID();
        const assetVersionId = randomUUID();
        const evidenceId = randomUUID();
        const execution = executions[0];
        if (!execution) {
          throw new CaptureControlError("NODE_EXECUTION_FAILED", "NodeExecution was not persisted");
        }
        await tx`
          insert into source_assets (id,workspace_id,product_id,kind)
          values (${sourceAssetId},${input.workspaceId},${locked.product_id},'node_evidence')
        `;
        await tx`
          insert into asset_versions (
            id,workspace_id,source_asset_id,r2_key,sha256,bytes,mime_type,metadata
          ) values (
            ${assetVersionId},${input.workspaceId},${sourceAssetId},${entry.r2Key},
            ${entry.sha256},${entry.bytes},${entry.mimeType},
            ${tx.json({ redactionStatus: "passed", jobId: input.jobId, attempt: input.attempt, manifestHash })}
          )
        `;
        await tx`
          insert into node_evidence (
            id,workspace_id,node_execution_id,kind,asset_version_id,manifest
          ) values (
            ${evidenceId},${input.workspaceId},${execution.id},${entry.kind},
            ${assetVersionId},${tx.json({ manifestHash, nodeId: entry.nodeId, actionId: entry.actionId ?? null })}
          )
        `;
        nodeEvidenceIds.push(evidenceId);
      }
      await tx`
        update capture_runs set status='completed',finished_at=now()
        where workspace_id=${input.workspaceId} and id=${input.manifest.runId}
      `;
      await tx`
        update capture_worker_jobs set status='completed',finished_at=now()
        where workspace_id=${input.workspaceId} and id=${input.jobId}
      `;
      await tx`
        update capture_sessions set state='completed',manifest_hash=${manifestHash},
          connectivity='disconnected',updated_at=now()
        where workspace_id=${input.workspaceId} and id=${locked.capture_session_id}
      `;
      const releases = await tx`
        update releases set capture_run_id=${input.manifest.runId},stage='evidence_review',
          revision=revision+1,updated_at=now()
        where workspace_id=${input.workspaceId} and id=${locked.release_id}
          and stage='capturing' and lifecycle='active'
        returning id
      `;
      if (!releases[0]) {
        throw new CaptureControlError("INVALID_RELEASE_STATE", "Capture completion requires a capturing Release");
      }
      return { manifestHash, nodeEvidenceIds: nodeEvidenceIds.sort() };
    });
  }

  private async requireCurrentLease(input: {
    workspaceId: string;
    jobId: string;
    attempt: number;
    leaseToken: string;
  }, allowCompletedReplay = false) {
    const rows = await this.sql`
      select j.*,s.current_job_id,s.current_attempt
      from capture_worker_jobs j
      join capture_sessions s on s.workspace_id=j.workspace_id and s.id=j.capture_session_id
      where j.workspace_id=${input.workspaceId} and j.id=${input.jobId}
    `;
    const job = rows[0];
    if (!job) throw new CaptureControlError("JOB_NOT_FOUND", "job not found");
    if (
      job.current_job_id !== input.jobId || job.current_attempt !== input.attempt ||
      job.attempt !== input.attempt || job.lease_token_hash !== hash(input.leaseToken) ||
      (new Date(job.lease_expires_at).getTime() <= Date.now() &&
        !(allowCompletedReplay && job.status === "completed"))
    ) {
      throw new CaptureControlError("STALE_ATTEMPT", "attempt is fenced or lease expired");
    }
    return job;
  }
}
