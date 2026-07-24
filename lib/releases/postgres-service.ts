import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { contentHash, parseProductFlowV1 } from "@purpleink/product-flow";
import {
  parseEvidencePackageV1,
  parseStoryboardV1,
} from "@/lib/releases/contracts";

type SqlClient = ReturnType<typeof postgres>;
type ApprovalObjectStore = {
  head(key: string): Promise<{
    bytes: number;
    sha256: string;
    mimeType: string;
  } | null>;
};

export class ReleaseCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ReleaseCommandError";
  }
}

type ApproveBriefInput = {
  workspaceId: string;
  releaseId: string;
  candidateId: string;
  expectedRevision: number;
  idempotencyKey: string;
  actorId: string;
};

type ApproveFlowInput = ApproveBriefInput & {
  discoveryRunId: string;
};

type ApproveEvidenceInput = ApproveBriefInput & {
  brandKitVersionId: string;
};

type StartDiscoveryInput = Omit<ApproveBriefInput, "candidateId"> & {
  productFlowId: string;
  captureSessionId: string;
  discoveryRunId: string;
  allowedOrigins: string[];
};

type StartCaptureInput = Omit<ApproveBriefInput, "candidateId"> & {
  captureSessionId: string;
  captureRunId: string;
  allowedOrigins: string[];
};

type ApproveNodeEvidenceInput = Omit<ApproveBriefInput, "candidateId"> & {
  nodeEvidenceId: string;
};

type ReleaseRow = {
  id: string;
  workspace_id: string;
  product_id: string;
  lifecycle: string;
  stage: string;
  failed_from_stage: string | null;
  revision: number;
  brief_version_id: string | null;
  product_flow_version_id: string | null;
  capture_run_id: string | null;
  evidence_package_version_id: string | null;
  storyboard_version_id: string | null;
  brand_kit_version_id: string | null;
  preview_bundle_id: string | null;
};

function releaseResult(row: ReleaseRow) {
  const refs: Record<string, string> = {};
  const mappings = [
    ["briefVersionId", row.brief_version_id],
    ["productFlowVersionId", row.product_flow_version_id],
    ["captureRunId", row.capture_run_id],
    ["evidencePackageVersionId", row.evidence_package_version_id],
    ["storyboardVersionId", row.storyboard_version_id],
    ["brandKitVersionId", row.brand_kit_version_id],
    ["previewBundleId", row.preview_bundle_id],
  ] as const;
  for (const [name, value] of mappings) if (value) refs[name] = value;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    productId: row.product_id,
    lifecycle: row.lifecycle,
    stage: row.stage,
    failedFromStage: row.failed_from_stage,
    revision: row.revision,
    refs,
  };
}

function fingerprint(input: ApproveBriefInput) {
  return JSON.stringify({
    command: "approve_brief",
    workspaceId: input.workspaceId,
    releaseId: input.releaseId,
    candidateId: input.candidateId,
    expectedRevision: input.expectedRevision,
    actorId: input.actorId,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class PostgresReleaseCommandService {
  constructor(
    private readonly sql: SqlClient,
    private readonly objectStore: ApprovalObjectStore
  ) {}

  private async assertApprovalObject(asset: Record<string, unknown>) {
    if (
      typeof asset.r2_key !== "string" ||
      typeof asset.sha256 !== "string" ||
      typeof asset.bytes !== "number" ||
      typeof asset.mime_type !== "string"
    ) {
      throw new ReleaseCommandError("EVIDENCE_OBJECT_INVALID", "Evidence object metadata is invalid");
    }
    let head;
    try {
      head = await this.objectStore.head(asset.r2_key);
    } catch {
      throw new ReleaseCommandError("EVIDENCE_OBJECT_UNAVAILABLE", "Evidence object storage is unavailable");
    }
    if (
      !head ||
      head.sha256 !== asset.sha256 ||
      head.bytes !== asset.bytes ||
      head.mimeType !== asset.mime_type
    ) {
      throw new ReleaseCommandError("EVIDENCE_OBJECT_INVALID", "Evidence object is missing or its metadata changed");
    }
  }

  async getRelease(workspaceId: string, releaseId: string) {
    const rows = await this.sql<ReleaseRow[]>`
      select * from releases where workspace_id=${workspaceId} and id=${releaseId}
    `;
    if (!rows[0]) {
      throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release not found");
    }
    return releaseResult(rows[0]);
  }

  async approveBrief(input: ApproveBriefInput) {
    if (!input.idempotencyKey) {
      throw new ReleaseCommandError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "idempotencyKey is required"
      );
    }
    const requestFingerprint = fingerprint(input);
    return this.sql.begin(async (tx) => {
      const memberships = await tx`
        select role from memberships
        where workspace_id=${input.workspaceId} and user_id=${input.actorId}
      `;
      if (!memberships[0] || !["owner", "admin"].includes(memberships[0].role)) {
        throw new ReleaseCommandError(
          "APPROVAL_FORBIDDEN",
          "approval requires owner or admin"
        );
      }

      const receipts = await tx`
        select fingerprint,result from command_receipts
        where workspace_id=${input.workspaceId}
          and idempotency_key=${input.idempotencyKey}
      `;
      if (receipts[0]) {
        if (receipts[0].fingerprint !== requestFingerprint) {
          throw new ReleaseCommandError(
            "IDEMPOTENCY_CONFLICT",
            "idempotency key belongs to another request"
          );
        }
        return receipts[0].result;
      }

      const releases = await tx<ReleaseRow[]>`
        select * from releases
        where workspace_id=${input.workspaceId} and id=${input.releaseId}
        for update
      `;
      const release = releases[0];
      if (!release) {
        throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release not found");
      }
      if (release.revision !== input.expectedRevision) {
        throw new ReleaseCommandError(
          "REVISION_CONFLICT",
          `expected revision ${input.expectedRevision}, found ${release.revision}`
        );
      }
      if (release.lifecycle !== "active" || release.stage !== "brief_draft") {
        throw new ReleaseCommandError(
          "INVALID_TRANSITION",
          `approve_brief is invalid from ${release.stage}`
        );
      }

      const candidates = await tx`
        select id,status,payload,content_hash from release_brief_versions
        where workspace_id=${input.workspaceId}
          and release_id=${input.releaseId}
          and id=${input.candidateId}
        for update
      `;
      const candidate = candidates[0];
      if (!candidate) {
        throw new ReleaseCommandError(
          "CANDIDATE_NOT_FOUND",
          "ReleaseBrief candidate not found"
        );
      }
      if (candidate.status !== "draft") {
        throw new ReleaseCommandError(
          "CANDIDATE_INVALID",
          "ReleaseBrief candidate must be draft"
        );
      }
      if ((await contentHash(candidate.payload)) !== candidate.content_hash) {
        throw new ReleaseCommandError(
          "CONTENT_HASH_MISMATCH",
          "ReleaseBrief candidate content hash is invalid"
        );
      }

      await tx`
        update release_brief_versions
        set status='approved',approved_at=now()
        where workspace_id=${input.workspaceId} and id=${input.candidateId}
      `;
      const approvalId = randomUUID();
      await tx`
        insert into approvals (
          id,workspace_id,release_id,subject_type,subject_id,decision,actor_id
        ) values (
          ${approvalId},${input.workspaceId},${input.releaseId},
          'release_brief_version',${input.candidateId},'approved',${input.actorId}
        )
      `;
      const updated = await tx<ReleaseRow[]>`
        update releases
        set brief_version_id=${input.candidateId},stage='flow_selecting',
            revision=revision+1,updated_at=now()
        where workspace_id=${input.workspaceId} and id=${input.releaseId}
        returning *
      `;
      const result = {
        release: releaseResult(
          updated[0] ?? (() => { throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release disappeared during approval"); })()
        ),
        approval: {
          id: approvalId,
          subjectType: "release_brief_version",
          subjectId: input.candidateId,
          decision: "approved",
        },
      };
      await tx`
        insert into audit_events (
          workspace_id,actor_type,actor_id,event_type,subject_type,subject_id,payload
        ) values (
          ${input.workspaceId},'user',${input.actorId},'release_brief.approved',
          'release_brief_version',${input.candidateId},${tx.json({ releaseId: input.releaseId })}
        )
      `;
      await tx`
        insert into command_receipts (
          workspace_id,release_id,idempotency_key,fingerprint,result
        ) values (
          ${input.workspaceId},${input.releaseId},${input.idempotencyKey},
          ${requestFingerprint},${tx.json(result)}
        )
      `;
      return result;
    });
  }

  async startDiscovery(input: StartDiscoveryInput) {
    if (!input.idempotencyKey) throw new ReleaseCommandError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required");
    if (!input.allowedOrigins.length || input.allowedOrigins.some((origin) => {
      try { return new URL(origin).protocol !== "https:"; } catch { return true; }
    })) {
      throw new ReleaseCommandError("ORIGIN_INVALID", "Discovery requires HTTPS allowed origins");
    }
    const requestFingerprint = JSON.stringify({
      command: "start_discovery", workspaceId: input.workspaceId,
      releaseId: input.releaseId,
      productFlowId: input.productFlowId, captureSessionId: input.captureSessionId,
      discoveryRunId: input.discoveryRunId, allowedOrigins: input.allowedOrigins,
      expectedRevision: input.expectedRevision, actorId: input.actorId,
    });
    return this.sql.begin(async (tx) => {
      const memberships = await tx`select role from memberships where workspace_id=${input.workspaceId} and user_id=${input.actorId}`;
      if (!memberships[0] || !["owner", "admin"].includes(memberships[0].role)) {
        throw new ReleaseCommandError("COMMAND_FORBIDDEN", "start_discovery requires owner or admin");
      }
      const receipts = await tx`select fingerprint,result from command_receipts where workspace_id=${input.workspaceId} and idempotency_key=${input.idempotencyKey}`;
      if (receipts[0]) {
        if (receipts[0].fingerprint !== requestFingerprint) throw new ReleaseCommandError("IDEMPOTENCY_CONFLICT", "idempotency key belongs to another request");
        return receipts[0].result;
      }
      const releases = await tx<ReleaseRow[]>`select * from releases where workspace_id=${input.workspaceId} and id=${input.releaseId} for update`;
      const release = releases[0];
      if (!release) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release not found");
      if (release.revision !== input.expectedRevision) throw new ReleaseCommandError("REVISION_CONFLICT", `expected revision ${input.expectedRevision}, found ${release.revision}`);
      if (release.lifecycle !== "active" || release.stage !== "flow_selecting" || !release.brief_version_id) {
        throw new ReleaseCommandError("INVALID_TRANSITION", "start_discovery requires flow_selecting with a pinned Brief");
      }
      const discoveryInputs = await tx`
        select f.id from product_flows f
        join release_brief_versions b
          on b.workspace_id=f.workspace_id and b.id=${release.brief_version_id}
        where f.workspace_id=${input.workspaceId} and f.id=${input.productFlowId}
          and f.product_id=${release.product_id} and b.status='approved'
      `;
      if (!discoveryInputs[0]) throw new ReleaseCommandError("DISCOVERY_INPUT_INVALID", "ProductFlow aggregate or pinned Brief is invalid");
      await tx`
        insert into capture_sessions(
          id,workspace_id,product_id,release_id,kind,state,connectivity,
          allowed_origins,expires_at,hard_expires_at
        ) values(
          ${input.captureSessionId},${input.workspaceId},${release.product_id},${input.releaseId},
          'discovery','created','disconnected',${tx.json(input.allowedOrigins)},
          now()+interval '30 minutes',now()+interval '60 minutes'
        )
      `;
      await tx`
        insert into discovery_runs(
          id,workspace_id,release_id,release_brief_version_id,product_flow_id,
          capture_session_id,status
        ) values(
          ${input.discoveryRunId},${input.workspaceId},${input.releaseId},${release.brief_version_id},
          ${input.productFlowId},${input.captureSessionId},'running'
        )
      `;
      const updated = await tx<ReleaseRow[]>`
        update releases set stage='flow_discovering',revision=revision+1,updated_at=now()
        where workspace_id=${input.workspaceId} and id=${input.releaseId} returning *
      `;
      const updatedRelease = updated[0];
      if (!updatedRelease) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release disappeared during discovery start");
      const result = { release: releaseResult(updatedRelease), discoveryRunId: input.discoveryRunId, captureSessionId: input.captureSessionId };
      await tx`insert into audit_events(workspace_id,actor_type,actor_id,event_type,subject_type,subject_id,payload) values(${input.workspaceId},'user',${input.actorId},'discovery.started','discovery_run',${input.discoveryRunId},${tx.json({ releaseId: input.releaseId, productFlowId: input.productFlowId })})`;
      await tx`insert into command_receipts(workspace_id,release_id,idempotency_key,fingerprint,result) values(${input.workspaceId},${input.releaseId},${input.idempotencyKey},${requestFingerprint},${tx.json(result)})`;
      return result;
    });
  }

  async approveFlow(input: ApproveFlowInput) {
    if (!input.idempotencyKey) {
      throw new ReleaseCommandError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required");
    }
    const requestFingerprint = JSON.stringify({
      command: "approve_flow",
      workspaceId: input.workspaceId,
      releaseId: input.releaseId,
      candidateId: input.candidateId,
      discoveryRunId: input.discoveryRunId,
      expectedRevision: input.expectedRevision,
      actorId: input.actorId,
    });
    return this.sql.begin(async (tx) => {
      const memberships = await tx`
        select role from memberships
        where workspace_id=${input.workspaceId} and user_id=${input.actorId}
      `;
      if (!memberships[0] || !["owner", "admin"].includes(memberships[0].role)) {
        throw new ReleaseCommandError("APPROVAL_FORBIDDEN", "approval requires owner or admin");
      }
      const receipts = await tx`
        select fingerprint,result from command_receipts
        where workspace_id=${input.workspaceId} and idempotency_key=${input.idempotencyKey}
      `;
      if (receipts[0]) {
        if (receipts[0].fingerprint !== requestFingerprint) {
          throw new ReleaseCommandError("IDEMPOTENCY_CONFLICT", "idempotency key belongs to another request");
        }
        return receipts[0].result;
      }
      const releases = await tx<ReleaseRow[]>`
        select * from releases
        where workspace_id=${input.workspaceId} and id=${input.releaseId}
        for update
      `;
      const release = releases[0];
      if (!release) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release not found");
      if (release.revision !== input.expectedRevision) {
        throw new ReleaseCommandError("REVISION_CONFLICT", `expected revision ${input.expectedRevision}, found ${release.revision}`);
      }
      if (release.lifecycle !== "active" || release.stage !== "flow_review") {
        throw new ReleaseCommandError("INVALID_TRANSITION", `approve_flow is invalid from ${release.stage}`);
      }
      const candidates = await tx`
        select v.id,v.status,v.payload,v.content_hash
        from product_flow_versions v
        join product_flows f
          on f.workspace_id=v.workspace_id and f.id=v.product_flow_id
        where v.workspace_id=${input.workspaceId} and v.id=${input.candidateId}
          and f.product_id=${release.product_id}
        for update of v
      `;
      const candidate = candidates[0];
      if (!candidate) throw new ReleaseCommandError("CANDIDATE_NOT_FOUND", "ProductFlow candidate not found");
      if (candidate.status !== "draft") throw new ReleaseCommandError("CANDIDATE_INVALID", "ProductFlow candidate must be draft");
      parseProductFlowV1(candidate.payload);
      if ((await contentHash(candidate.payload)) !== candidate.content_hash) {
        throw new ReleaseCommandError("CONTENT_HASH_MISMATCH", "ProductFlow candidate content hash is invalid");
      }
      const discoveryRuns = await tx`
        select d.status,d.release_brief_version_id,d.proposed_version_id,
          d.clean_replay_manifest_hash,d.clean_replay_worker_image_digest,
          d.clean_replay_passed_at,cs.manifest_hash,j.image_digest,j.status as job_status
        from discovery_runs d
        join capture_sessions cs
          on cs.workspace_id=d.workspace_id and cs.id=d.capture_session_id
        join capture_worker_jobs j
          on j.workspace_id=cs.workspace_id and j.id=cs.current_job_id
          and j.attempt=cs.current_attempt
        where d.workspace_id=${input.workspaceId} and d.id=${input.discoveryRunId}
          and d.release_id=${input.releaseId}
      `;
      const discovery = discoveryRuns[0];
      if (
        !discovery || discovery.status !== "completed" ||
        discovery.proposed_version_id !== input.candidateId ||
        discovery.release_brief_version_id !== release.brief_version_id ||
        !discovery.clean_replay_passed_at ||
        discovery.clean_replay_manifest_hash !== discovery.manifest_hash ||
        discovery.clean_replay_worker_image_digest !== discovery.image_digest ||
        discovery.job_status !== "completed"
      ) {
        throw new ReleaseCommandError("CLEAN_REPLAY_REQUIRED", "persisted clean replay provenance is invalid");
      }
      await tx`
        update product_flow_versions set status='approved',approved_at=now()
        where workspace_id=${input.workspaceId} and id=${input.candidateId}
      `;
      const approvalId = randomUUID();
      await tx`
        insert into approvals(id,workspace_id,release_id,subject_type,subject_id,decision,actor_id)
        values(${approvalId},${input.workspaceId},${input.releaseId},'product_flow_version',${input.candidateId},'approved',${input.actorId})
      `;
      const updated = await tx<ReleaseRow[]>`
        update releases set product_flow_version_id=${input.candidateId},
          stage='capture_pending',revision=revision+1,updated_at=now()
        where workspace_id=${input.workspaceId} and id=${input.releaseId}
        returning *
      `;
      const updatedRelease = updated[0];
      if (!updatedRelease) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release disappeared during approval");
      const result = {
        release: releaseResult(updatedRelease),
        approval: { id: approvalId, subjectType: "product_flow_version", subjectId: input.candidateId, decision: "approved" },
      };
      await tx`
        insert into audit_events(workspace_id,actor_type,actor_id,event_type,subject_type,subject_id,payload)
        values(${input.workspaceId},'user',${input.actorId},'product_flow.approved','product_flow_version',${input.candidateId},${tx.json({ releaseId: input.releaseId, discoveryRunId: input.discoveryRunId, workerImageDigest: discovery.clean_replay_worker_image_digest })})
      `;
      await tx`
        insert into command_receipts(workspace_id,release_id,idempotency_key,fingerprint,result)
        values(${input.workspaceId},${input.releaseId},${input.idempotencyKey},${requestFingerprint},${tx.json(result)})
      `;
      return result;
    });
  }

  async startCapture(input: StartCaptureInput) {
    if (!input.idempotencyKey) throw new ReleaseCommandError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required");
    if (!input.allowedOrigins.length || input.allowedOrigins.some((origin) => {
      try { return new URL(origin).protocol !== "https:"; } catch { return true; }
    })) {
      throw new ReleaseCommandError("ORIGIN_INVALID", "Capture requires HTTPS allowed origins");
    }
    const requestFingerprint = JSON.stringify({
      command: "start_capture", workspaceId: input.workspaceId,
      releaseId: input.releaseId, captureSessionId: input.captureSessionId,
      captureRunId: input.captureRunId, allowedOrigins: input.allowedOrigins,
      expectedRevision: input.expectedRevision, actorId: input.actorId,
    });
    return this.sql.begin(async (tx) => {
      const memberships = await tx`select role from memberships where workspace_id=${input.workspaceId} and user_id=${input.actorId}`;
      if (!memberships[0] || !["owner", "admin"].includes(memberships[0].role)) {
        throw new ReleaseCommandError("COMMAND_FORBIDDEN", "start_capture requires owner or admin");
      }
      const receipts = await tx`select fingerprint,result from command_receipts where workspace_id=${input.workspaceId} and idempotency_key=${input.idempotencyKey}`;
      if (receipts[0]) {
        if (receipts[0].fingerprint !== requestFingerprint) throw new ReleaseCommandError("IDEMPOTENCY_CONFLICT", "idempotency key belongs to another request");
        return receipts[0].result;
      }
      const releases = await tx<ReleaseRow[]>`select * from releases where workspace_id=${input.workspaceId} and id=${input.releaseId} for update`;
      const release = releases[0];
      if (!release) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release not found");
      if (release.revision !== input.expectedRevision) throw new ReleaseCommandError("REVISION_CONFLICT", `expected revision ${input.expectedRevision}, found ${release.revision}`);
      if (release.lifecycle !== "active" || release.stage !== "capture_pending" || !release.product_flow_version_id) {
        throw new ReleaseCommandError("INVALID_TRANSITION", "start_capture requires capture_pending with a pinned Flow");
      }
      const flows = await tx`
        select v.id from product_flow_versions v
        join product_flows f on f.workspace_id=v.workspace_id and f.id=v.product_flow_id
        where v.workspace_id=${input.workspaceId} and v.id=${release.product_flow_version_id}
          and v.status='approved' and f.product_id=${release.product_id}
      `;
      if (!flows[0]) throw new ReleaseCommandError("FLOW_INVALID", "Pinned ProductFlowVersion is not approved for the Release product");
      await tx`
        insert into capture_sessions(
          id,workspace_id,product_id,release_id,kind,state,connectivity,
          allowed_origins,expires_at,hard_expires_at
        ) values(
          ${input.captureSessionId},${input.workspaceId},${release.product_id},${input.releaseId},
          'capture','created','disconnected',${tx.json(input.allowedOrigins)},
          now()+interval '30 minutes',now()+interval '60 minutes'
        )
      `;
      await tx`
        insert into capture_runs(
          id,workspace_id,release_id,flow_version_id,capture_session_id,status
        ) values(
          ${input.captureRunId},${input.workspaceId},${input.releaseId},
          ${release.product_flow_version_id},${input.captureSessionId},'pending'
        )
      `;
      const updated = await tx<ReleaseRow[]>`
        update releases set stage='capturing',revision=revision+1,updated_at=now()
        where workspace_id=${input.workspaceId} and id=${input.releaseId} returning *
      `;
      const updatedRelease = updated[0];
      if (!updatedRelease) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release disappeared during capture start");
      const result = { release: releaseResult(updatedRelease), captureRunId: input.captureRunId, captureSessionId: input.captureSessionId };
      await tx`insert into audit_events(workspace_id,actor_type,actor_id,event_type,subject_type,subject_id,payload) values(${input.workspaceId},'user',${input.actorId},'capture.started','capture_run',${input.captureRunId},${tx.json({ releaseId: input.releaseId, flowVersionId: release.product_flow_version_id })})`;
      await tx`insert into command_receipts(workspace_id,release_id,idempotency_key,fingerprint,result) values(${input.workspaceId},${input.releaseId},${input.idempotencyKey},${requestFingerprint},${tx.json(result)})`;
      return result;
    });
  }

  async approveNodeEvidence(input: ApproveNodeEvidenceInput) {
    if (!input.idempotencyKey) throw new ReleaseCommandError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required");
    const requestFingerprint = JSON.stringify({
      command: "approve_node_evidence", workspaceId: input.workspaceId,
      releaseId: input.releaseId, nodeEvidenceId: input.nodeEvidenceId,
      expectedRevision: input.expectedRevision, actorId: input.actorId,
    });
    return this.sql.begin(async (tx) => {
      const memberships = await tx`select role from memberships where workspace_id=${input.workspaceId} and user_id=${input.actorId}`;
      if (!memberships[0] || !["owner", "admin"].includes(memberships[0].role)) {
        throw new ReleaseCommandError("APPROVAL_FORBIDDEN", "approval requires owner or admin");
      }
      const receipts = await tx`select fingerprint,result from command_receipts where workspace_id=${input.workspaceId} and idempotency_key=${input.idempotencyKey}`;
      if (receipts[0]) {
        if (receipts[0].fingerprint !== requestFingerprint) throw new ReleaseCommandError("IDEMPOTENCY_CONFLICT", "idempotency key belongs to another request");
        return receipts[0].result;
      }
      const releases = await tx<ReleaseRow[]>`select * from releases where workspace_id=${input.workspaceId} and id=${input.releaseId} for update`;
      const release = releases[0];
      if (!release) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release not found");
      if (release.revision !== input.expectedRevision) throw new ReleaseCommandError("REVISION_CONFLICT", `expected revision ${input.expectedRevision}, found ${release.revision}`);
      if (release.lifecycle !== "active" || release.stage !== "evidence_review" || !release.capture_run_id) {
        throw new ReleaseCommandError("INVALID_TRANSITION", "NodeEvidence approval requires evidence_review with a pinned CaptureRun");
      }
      const rows = await tx`
        select ne.approved_at,av.metadata,nx.capture_run_id,
          av.r2_key,av.sha256,av.bytes,av.mime_type
        from node_evidence ne
        join node_executions nx on nx.workspace_id=ne.workspace_id and nx.id=ne.node_execution_id
        join asset_versions av on av.workspace_id=ne.workspace_id and av.id=ne.asset_version_id
        where ne.workspace_id=${input.workspaceId} and ne.id=${input.nodeEvidenceId}
        for update of ne
      `;
      const evidence = rows[0];
      const metadata = isRecord(evidence?.metadata) ? evidence.metadata : {};
      if (!evidence || evidence.approved_at || evidence.capture_run_id !== release.capture_run_id || metadata.redactionStatus !== "passed") {
        throw new ReleaseCommandError("EVIDENCE_INVALID", "NodeEvidence is not an approvable item from the pinned CaptureRun");
      }
      await this.assertApprovalObject(evidence);
      await tx`update node_evidence set approved_at=now() where workspace_id=${input.workspaceId} and id=${input.nodeEvidenceId}`;
      const approvalId = randomUUID();
      await tx`insert into approvals(id,workspace_id,release_id,subject_type,subject_id,decision,actor_id) values(${approvalId},${input.workspaceId},${input.releaseId},'node_evidence',${input.nodeEvidenceId},'approved',${input.actorId})`;
      const updated = await tx<ReleaseRow[]>`update releases set revision=revision+1,updated_at=now() where workspace_id=${input.workspaceId} and id=${input.releaseId} returning *`;
      const updatedRelease = updated[0];
      if (!updatedRelease) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release disappeared during evidence approval");
      const result = { release: releaseResult(updatedRelease), approval: { id: approvalId, subjectType: "node_evidence", subjectId: input.nodeEvidenceId, decision: "approved" } };
      await tx`insert into audit_events(workspace_id,actor_type,actor_id,event_type,subject_type,subject_id,payload) values(${input.workspaceId},'user',${input.actorId},'node_evidence.approved','node_evidence',${input.nodeEvidenceId},${tx.json({ releaseId: input.releaseId, captureRunId: release.capture_run_id })})`;
      await tx`insert into command_receipts(workspace_id,release_id,idempotency_key,fingerprint,result) values(${input.workspaceId},${input.releaseId},${input.idempotencyKey},${requestFingerprint},${tx.json(result)})`;
      return result;
    });
  }

  async approveEvidence(input: ApproveEvidenceInput) {
    if (!input.idempotencyKey) {
      throw new ReleaseCommandError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required");
    }
    const requestFingerprint = JSON.stringify({
      command: "approve_evidence",
      workspaceId: input.workspaceId,
      releaseId: input.releaseId,
      candidateId: input.candidateId,
      brandKitVersionId: input.brandKitVersionId,
      expectedRevision: input.expectedRevision,
      actorId: input.actorId,
    });
    return this.sql.begin(async (tx) => {
      const memberships = await tx`
        select role from memberships
        where workspace_id=${input.workspaceId} and user_id=${input.actorId}
      `;
      if (!memberships[0] || !["owner", "admin"].includes(memberships[0].role)) {
        throw new ReleaseCommandError("APPROVAL_FORBIDDEN", "approval requires owner or admin");
      }
      const receipts = await tx`
        select fingerprint,result from command_receipts
        where workspace_id=${input.workspaceId} and idempotency_key=${input.idempotencyKey}
      `;
      if (receipts[0]) {
        if (receipts[0].fingerprint !== requestFingerprint) {
          throw new ReleaseCommandError("IDEMPOTENCY_CONFLICT", "idempotency key belongs to another request");
        }
        return receipts[0].result;
      }

      const releases = await tx<ReleaseRow[]>`
        select * from releases
        where workspace_id=${input.workspaceId} and id=${input.releaseId}
        for update
      `;
      const release = releases[0];
      if (!release) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release not found");
      if (release.revision !== input.expectedRevision) {
        throw new ReleaseCommandError("REVISION_CONFLICT", `expected revision ${input.expectedRevision}, found ${release.revision}`);
      }
      if (release.lifecycle !== "active" || release.stage !== "evidence_review") {
        throw new ReleaseCommandError("INVALID_TRANSITION", `approve_evidence is invalid from ${release.stage}`);
      }

      const candidates = await tx`
        select v.id,v.status,v.payload,v.content_hash,v.capture_run_id,
          p.release_id,cr.status as capture_status,cr.flow_version_id,
          cs.manifest_hash,j.image_digest
        from evidence_package_versions v
        join evidence_packages p
          on p.workspace_id=v.workspace_id and p.id=v.evidence_package_id
        join capture_runs cr
          on cr.workspace_id=v.workspace_id and cr.id=v.capture_run_id
        join capture_sessions cs
          on cs.workspace_id=cr.workspace_id and cs.id=cr.capture_session_id
        join capture_worker_jobs j
          on j.workspace_id=cs.workspace_id and j.id=cs.current_job_id
          and j.attempt=cs.current_attempt
        where v.workspace_id=${input.workspaceId} and v.id=${input.candidateId}
        for update of v
      `;
      const candidate = candidates[0];
      if (!candidate || candidate.release_id !== input.releaseId) {
        throw new ReleaseCommandError("CANDIDATE_NOT_FOUND", "EvidencePackage candidate not found");
      }
      if (candidate.status !== "draft") {
        throw new ReleaseCommandError("CANDIDATE_INVALID", "EvidencePackage candidate must be draft");
      }
      let payload;
      try {
        payload = parseEvidencePackageV1(candidate.payload);
      } catch {
        throw new ReleaseCommandError("CANDIDATE_INVALID", "EvidencePackage payload is invalid");
      }
      if ((await contentHash(candidate.payload)) !== candidate.content_hash) {
        throw new ReleaseCommandError("CONTENT_HASH_MISMATCH", "EvidencePackage candidate content hash is invalid");
      }
      if (
        payload.releaseId !== input.releaseId ||
        payload.captureRunId !== candidate.capture_run_id ||
        candidate.capture_run_id !== release.capture_run_id ||
        candidate.capture_status !== "completed" ||
        candidate.flow_version_id !== release.product_flow_version_id ||
        payload.provenance.flowVersionId !== candidate.flow_version_id ||
        payload.provenance.manifestHash !== candidate.manifest_hash ||
        payload.provenance.workerImageDigest !== candidate.image_digest
      ) {
        throw new ReleaseCommandError("PROVENANCE_MISMATCH", "EvidencePackage provenance does not match the pinned capture");
      }

      const brandVersions = await tx`
        select v.id from brand_kit_versions v
        join brand_kits k on k.workspace_id=v.workspace_id and k.id=v.brand_kit_id
        where v.workspace_id=${input.workspaceId} and v.id=${input.brandKitVersionId}
          and v.status='approved' and k.product_id=${release.product_id}
      `;
      if (!brandVersions[0]) {
        throw new ReleaseCommandError("BRAND_KIT_INVALID", "BrandKitVersion must be approved for the Release product");
      }

      const seenRefs = new Set<string>();
      for (const ref of payload.refs) {
        const refKey = `${ref.kind}:${ref.assetVersionId}`;
        if (seenRefs.has(refKey)) {
          throw new ReleaseCommandError("CANDIDATE_INVALID", "EvidencePackage contains duplicate refs");
        }
        seenRefs.add(refKey);
        if (ref.kind === "node_evidence") {
          const rows = await tx`
            select ne.approved_at,ne.asset_version_id,ne.manifest,
              av.metadata,av.r2_key,av.sha256,av.bytes,av.mime_type,
              nx.capture_run_id
            from node_evidence ne
            join node_executions nx
              on nx.workspace_id=ne.workspace_id and nx.id=ne.node_execution_id
            join asset_versions av
              on av.workspace_id=ne.workspace_id and av.id=ne.asset_version_id
            where ne.workspace_id=${input.workspaceId} and ne.id=${ref.nodeEvidenceId}
            for update of ne
          `;
          const evidence = rows[0];
          const metadata = isRecord(evidence?.metadata) ? evidence.metadata : {};
          const manifest = isRecord(evidence?.manifest) ? evidence.manifest : {};
          if (
            !evidence?.approved_at ||
            evidence.asset_version_id !== ref.assetVersionId ||
            evidence.capture_run_id !== candidate.capture_run_id ||
            metadata.redactionStatus !== "passed" ||
            metadata.manifestHash !== payload.provenance.manifestHash ||
            manifest.manifestHash !== payload.provenance.manifestHash
          ) {
            throw new ReleaseCommandError("EVIDENCE_INVALID", "NodeEvidence is not approved capture evidence");
          }
          await this.assertApprovalObject(evidence);
        } else {
          const rows = await tx`
            select av.id,av.r2_key,av.sha256,av.bytes,av.mime_type
            from asset_versions av
            join source_assets sa
              on sa.workspace_id=av.workspace_id and sa.id=av.source_asset_id
            join approvals a
              on a.workspace_id=av.workspace_id and a.subject_type='asset_version'
              and a.subject_id=av.id and a.decision='approved'
            where av.workspace_id=${input.workspaceId} and av.id=${ref.assetVersionId}
              and sa.id=${ref.sourceAssetId} and sa.product_id=${release.product_id}
            limit 1
          `;
          if (!rows[0]) {
            throw new ReleaseCommandError("EVIDENCE_INVALID", "SourceAsset version is not approved for the Release product");
          }
          await this.assertApprovalObject(rows[0]);
        }
      }

      await tx`
        update evidence_package_versions set status='approved',approved_at=now()
        where workspace_id=${input.workspaceId} and id=${input.candidateId}
      `;
      const approvalId = randomUUID();
      await tx`
        insert into approvals(id,workspace_id,release_id,subject_type,subject_id,decision,actor_id)
        values(${approvalId},${input.workspaceId},${input.releaseId},'evidence_package_version',${input.candidateId},'approved',${input.actorId})
      `;
      const updated = await tx<ReleaseRow[]>`
        update releases set evidence_package_version_id=${input.candidateId},
          brand_kit_version_id=${input.brandKitVersionId},stage='storyboard_generating',
          revision=revision+1,updated_at=now()
        where workspace_id=${input.workspaceId} and id=${input.releaseId}
        returning *
      `;
      const updatedRelease = updated[0];
      if (!updatedRelease) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release disappeared during approval");
      const result = {
        release: releaseResult(updatedRelease),
        approval: { id: approvalId, subjectType: "evidence_package_version", subjectId: input.candidateId, decision: "approved" },
      };
      await tx`
        insert into audit_events(workspace_id,actor_type,actor_id,event_type,subject_type,subject_id,payload)
        values(${input.workspaceId},'user',${input.actorId},'evidence_package.approved','evidence_package_version',${input.candidateId},${tx.json({ releaseId: input.releaseId, captureRunId: candidate.capture_run_id, brandKitVersionId: input.brandKitVersionId })})
      `;
      await tx`
        insert into command_receipts(workspace_id,release_id,idempotency_key,fingerprint,result)
        values(${input.workspaceId},${input.releaseId},${input.idempotencyKey},${requestFingerprint},${tx.json(result)})
      `;
      return result;
    });
  }

  async storyboardGenerated(input: ApproveBriefInput) {
    if (!input.idempotencyKey) throw new ReleaseCommandError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required");
    const requestFingerprint = JSON.stringify({
      command: "storyboard_generated", workspaceId: input.workspaceId,
      releaseId: input.releaseId, candidateId: input.candidateId,
      expectedRevision: input.expectedRevision, actorId: input.actorId,
    });
    return this.sql.begin(async (tx) => {
      const memberships = await tx`select role from memberships where workspace_id=${input.workspaceId} and user_id=${input.actorId}`;
      if (!memberships[0] || !["owner", "admin"].includes(memberships[0].role)) {
        throw new ReleaseCommandError("COMMAND_FORBIDDEN", "storyboard generation requires owner or admin");
      }
      const receipts = await tx`select fingerprint,result from command_receipts where workspace_id=${input.workspaceId} and idempotency_key=${input.idempotencyKey}`;
      if (receipts[0]) {
        if (receipts[0].fingerprint !== requestFingerprint) throw new ReleaseCommandError("IDEMPOTENCY_CONFLICT", "idempotency key belongs to another request");
        return receipts[0].result;
      }
      const releases = await tx<ReleaseRow[]>`select * from releases where workspace_id=${input.workspaceId} and id=${input.releaseId} for update`;
      const release = releases[0];
      if (!release) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release not found");
      if (release.revision !== input.expectedRevision) throw new ReleaseCommandError("REVISION_CONFLICT", `expected revision ${input.expectedRevision}, found ${release.revision}`);
      if (release.lifecycle !== "active" || release.stage !== "storyboard_generating" || !release.evidence_package_version_id) {
        throw new ReleaseCommandError("INVALID_TRANSITION", "storyboard_generated requires pinned evidence in storyboard_generating");
      }
      const candidates = await tx`
        select v.status,v.payload,v.content_hash,s.release_id
        from storyboard_versions v
        join storyboards s on s.workspace_id=v.workspace_id and s.id=v.storyboard_id
        where v.workspace_id=${input.workspaceId} and v.id=${input.candidateId}
      `;
      const candidate = candidates[0];
      if (!candidate || candidate.release_id !== input.releaseId || candidate.status !== "draft") {
        throw new ReleaseCommandError("CANDIDATE_INVALID", "Storyboard candidate must be a draft for this Release");
      }
      let storyboard;
      try { storyboard = parseStoryboardV1(candidate.payload); }
      catch { throw new ReleaseCommandError("CANDIDATE_INVALID", "Storyboard payload is invalid"); }
      if ((await contentHash(candidate.payload)) !== candidate.content_hash) {
        throw new ReleaseCommandError("CONTENT_HASH_MISMATCH", "Storyboard candidate content hash is invalid");
      }
      if (storyboard.releaseId !== input.releaseId || storyboard.evidencePackageVersionId !== release.evidence_package_version_id) {
        throw new ReleaseCommandError("PROVENANCE_MISMATCH", "Storyboard does not reference the Release-pinned evidence package");
      }
      const evidenceRows = await tx`select payload,status from evidence_package_versions where workspace_id=${input.workspaceId} and id=${release.evidence_package_version_id}`;
      if (evidenceRows[0]?.status !== "approved") throw new ReleaseCommandError("EVIDENCE_INVALID", "Pinned EvidencePackageVersion is not approved");
      let evidencePackage;
      try { evidencePackage = parseEvidencePackageV1(evidenceRows[0].payload); }
      catch { throw new ReleaseCommandError("EVIDENCE_INVALID", "Pinned EvidencePackageVersion is invalid"); }
      const evidenceKeys = new Set(evidencePackage.refs.map((ref) => ref.kind === "node_evidence" ? `node_evidence:${ref.nodeEvidenceId}:${ref.assetVersionId}` : `source_asset:${ref.sourceAssetId}:${ref.assetVersionId}`));
      for (const scene of storyboard.scenes) {
        const capabilities = await tx`select id from product_capabilities where workspace_id=${input.workspaceId} and id=${scene.capabilityId} and product_id=${release.product_id} and status='active'`;
        if (!capabilities[0]) throw new ReleaseCommandError("CAPABILITY_INVALID", "Storyboard Scene capability is not active for the Release product");
        for (const ref of scene.evidence) {
          const key = ref.kind === "node_evidence" ? `node_evidence:${ref.nodeEvidenceId}:${ref.assetVersionId}` : `source_asset:${ref.sourceAssetId}:${ref.assetVersionId}`;
          if (!evidenceKeys.has(key)) throw new ReleaseCommandError("EVIDENCE_INVALID", "Storyboard Scene references evidence outside the pinned package");
        }
      }
      const updated = await tx<ReleaseRow[]>`update releases set stage='storyboard_review',revision=revision+1,updated_at=now() where workspace_id=${input.workspaceId} and id=${input.releaseId} returning *`;
      const updatedRelease = updated[0];
      if (!updatedRelease) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release disappeared during storyboard generation");
      const result = { release: releaseResult(updatedRelease), storyboardVersionId: input.candidateId };
      await tx`insert into audit_events(workspace_id,actor_type,actor_id,event_type,subject_type,subject_id,payload) values(${input.workspaceId},'user',${input.actorId},'storyboard.generated','storyboard_version',${input.candidateId},${tx.json({ releaseId: input.releaseId, evidencePackageVersionId: release.evidence_package_version_id })})`;
      await tx`insert into command_receipts(workspace_id,release_id,idempotency_key,fingerprint,result) values(${input.workspaceId},${input.releaseId},${input.idempotencyKey},${requestFingerprint},${tx.json(result)})`;
      return result;
    });
  }

  async approveStoryboard(input: ApproveBriefInput) {
    if (!input.idempotencyKey) {
      throw new ReleaseCommandError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required");
    }
    const requestFingerprint = JSON.stringify({
      command: "approve_storyboard",
      workspaceId: input.workspaceId,
      releaseId: input.releaseId,
      candidateId: input.candidateId,
      expectedRevision: input.expectedRevision,
      actorId: input.actorId,
    });
    return this.sql.begin(async (tx) => {
      const memberships = await tx`
        select role from memberships
        where workspace_id=${input.workspaceId} and user_id=${input.actorId}
      `;
      if (!memberships[0] || !["owner", "admin"].includes(memberships[0].role)) {
        throw new ReleaseCommandError("APPROVAL_FORBIDDEN", "approval requires owner or admin");
      }
      const receipts = await tx`
        select fingerprint,result from command_receipts
        where workspace_id=${input.workspaceId} and idempotency_key=${input.idempotencyKey}
      `;
      if (receipts[0]) {
        if (receipts[0].fingerprint !== requestFingerprint) {
          throw new ReleaseCommandError("IDEMPOTENCY_CONFLICT", "idempotency key belongs to another request");
        }
        return receipts[0].result;
      }

      const releases = await tx<ReleaseRow[]>`
        select * from releases
        where workspace_id=${input.workspaceId} and id=${input.releaseId}
        for update
      `;
      const release = releases[0];
      if (!release) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release not found");
      if (release.revision !== input.expectedRevision) {
        throw new ReleaseCommandError("REVISION_CONFLICT", `expected revision ${input.expectedRevision}, found ${release.revision}`);
      }
      if (release.lifecycle !== "active" || release.stage !== "storyboard_review") {
        throw new ReleaseCommandError("INVALID_TRANSITION", `approve_storyboard is invalid from ${release.stage}`);
      }
      if (!release.evidence_package_version_id || !release.brand_kit_version_id) {
        throw new ReleaseCommandError("PINNED_INPUT_REQUIRED", "Storyboard approval requires pinned Evidence and BrandKit versions");
      }

      const candidates = await tx`
        select v.id,v.status,v.payload,v.content_hash,s.release_id
        from storyboard_versions v
        join storyboards s
          on s.workspace_id=v.workspace_id and s.id=v.storyboard_id
        where v.workspace_id=${input.workspaceId} and v.id=${input.candidateId}
        for update of v
      `;
      const candidate = candidates[0];
      if (!candidate || candidate.release_id !== input.releaseId) {
        throw new ReleaseCommandError("CANDIDATE_NOT_FOUND", "Storyboard candidate not found");
      }
      if (candidate.status !== "draft") {
        throw new ReleaseCommandError("CANDIDATE_INVALID", "Storyboard candidate must be draft");
      }
      let storyboard;
      try {
        storyboard = parseStoryboardV1(candidate.payload);
      } catch {
        throw new ReleaseCommandError("CANDIDATE_INVALID", "Storyboard payload is invalid");
      }
      if ((await contentHash(candidate.payload)) !== candidate.content_hash) {
        throw new ReleaseCommandError("CONTENT_HASH_MISMATCH", "Storyboard candidate content hash is invalid");
      }
      if (
        storyboard.releaseId !== input.releaseId ||
        storyboard.evidencePackageVersionId !== release.evidence_package_version_id
      ) {
        throw new ReleaseCommandError("PROVENANCE_MISMATCH", "Storyboard does not reference the Release-pinned evidence package");
      }

      const evidenceRows = await tx`
        select payload,status from evidence_package_versions
        where workspace_id=${input.workspaceId} and id=${release.evidence_package_version_id}
      `;
      if (evidenceRows[0]?.status !== "approved") {
        throw new ReleaseCommandError("EVIDENCE_INVALID", "Release-pinned EvidencePackageVersion is not approved");
      }
      let evidencePackage;
      try {
        evidencePackage = parseEvidencePackageV1(evidenceRows[0].payload);
      } catch {
        throw new ReleaseCommandError("EVIDENCE_INVALID", "Release-pinned EvidencePackageVersion is invalid");
      }
      const evidenceKeys = new Set(evidencePackage.refs.map((ref) =>
        ref.kind === "node_evidence"
          ? `node_evidence:${ref.nodeEvidenceId}:${ref.assetVersionId}`
          : `source_asset:${ref.sourceAssetId}:${ref.assetVersionId}`
      ));
      for (const scene of storyboard.scenes) {
        const capabilities = await tx`
          select id from product_capabilities
          where workspace_id=${input.workspaceId} and id=${scene.capabilityId}
            and product_id=${release.product_id} and status='active'
        `;
        if (!capabilities[0]) {
          throw new ReleaseCommandError("CAPABILITY_INVALID", "Storyboard Scene capability is not active for the Release product");
        }
        for (const ref of scene.evidence) {
          const key = ref.kind === "node_evidence"
            ? `node_evidence:${ref.nodeEvidenceId}:${ref.assetVersionId}`
            : `source_asset:${ref.sourceAssetId}:${ref.assetVersionId}`;
          if (!evidenceKeys.has(key)) {
            throw new ReleaseCommandError("EVIDENCE_INVALID", "Storyboard Scene references evidence outside the pinned package");
          }
        }
      }

      await tx`
        update storyboard_versions set status='approved',approved_at=now()
        where workspace_id=${input.workspaceId} and id=${input.candidateId}
      `;
      const approvalId = randomUUID();
      await tx`
        insert into approvals(id,workspace_id,release_id,subject_type,subject_id,decision,actor_id)
        values(${approvalId},${input.workspaceId},${input.releaseId},'storyboard_version',${input.candidateId},'approved',${input.actorId})
      `;
      const updated = await tx<ReleaseRow[]>`
        update releases set storyboard_version_id=${input.candidateId},
          stage='preview_queued',revision=revision+1,updated_at=now()
        where workspace_id=${input.workspaceId} and id=${input.releaseId}
        returning *
      `;
      const updatedRelease = updated[0];
      if (!updatedRelease) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release disappeared during approval");
      const result = {
        release: releaseResult(updatedRelease),
        approval: { id: approvalId, subjectType: "storyboard_version", subjectId: input.candidateId, decision: "approved" },
      };
      await tx`
        insert into audit_events(workspace_id,actor_type,actor_id,event_type,subject_type,subject_id,payload)
        values(${input.workspaceId},'user',${input.actorId},'storyboard.approved','storyboard_version',${input.candidateId},${tx.json({ releaseId: input.releaseId, evidencePackageVersionId: release.evidence_package_version_id })})
      `;
      await tx`
        insert into command_receipts(workspace_id,release_id,idempotency_key,fingerprint,result)
        values(${input.workspaceId},${input.releaseId},${input.idempotencyKey},${requestFingerprint},${tx.json(result)})
      `;
      return result;
    });
  }

  async repinStoryboard(input: ApproveBriefInput) {
    if (!input.idempotencyKey) throw new ReleaseCommandError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required");
    const requestFingerprint = JSON.stringify({
      command: "repin_storyboard", workspaceId: input.workspaceId,
      releaseId: input.releaseId, candidateId: input.candidateId,
      expectedRevision: input.expectedRevision, actorId: input.actorId,
    });
    return this.sql.begin(async (tx) => {
      const memberships = await tx`select role from memberships where workspace_id=${input.workspaceId} and user_id=${input.actorId}`;
      if (!memberships[0] || !["owner", "admin"].includes(memberships[0].role)) {
        throw new ReleaseCommandError("COMMAND_FORBIDDEN", "repin requires owner or admin");
      }
      const receipts = await tx`select fingerprint,result from command_receipts where workspace_id=${input.workspaceId} and idempotency_key=${input.idempotencyKey}`;
      if (receipts[0]) {
        if (receipts[0].fingerprint !== requestFingerprint) throw new ReleaseCommandError("IDEMPOTENCY_CONFLICT", "idempotency key belongs to another request");
        return receipts[0].result;
      }
      const releases = await tx<ReleaseRow[]>`select * from releases where workspace_id=${input.workspaceId} and id=${input.releaseId} for update`;
      const release = releases[0];
      if (!release) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release not found");
      if (release.revision !== input.expectedRevision) throw new ReleaseCommandError("REVISION_CONFLICT", `expected revision ${input.expectedRevision}, found ${release.revision}`);
      if (release.lifecycle !== "active" || !release.storyboard_version_id || release.storyboard_version_id === input.candidateId) {
        throw new ReleaseCommandError("REPIN_INVALID", "repin_storyboard requires a different pinned StoryboardVersion on an active Release");
      }
      const candidates = await tx`
        select v.id from storyboard_versions v
        join storyboards s on s.workspace_id=v.workspace_id and s.id=v.storyboard_id
        where v.workspace_id=${input.workspaceId} and v.id=${input.candidateId}
          and v.status='approved' and s.release_id=${input.releaseId}
      `;
      if (!candidates[0]) throw new ReleaseCommandError("CANDIDATE_INVALID", "replacement StoryboardVersion is not approved for this Release");

      const staleObjects = await tx`
        select 'composition_bundle' as object_type,b.id as object_id
        from composition_bundles b
        where b.workspace_id=${input.workspaceId} and b.release_id=${input.releaseId}
          and b.storyboard_version_id=${release.storyboard_version_id}
        union all
        select 'render_job' as object_type,r.id as object_id
        from render_jobs r
        join composition_bundles b on b.workspace_id=r.workspace_id and b.id=r.bundle_id
        where r.workspace_id=${input.workspaceId} and r.release_id=${input.releaseId}
          and b.storyboard_version_id=${release.storyboard_version_id}
      `;
      await tx`
        update render_jobs set status='stale',updated_at=now()
        where workspace_id=${input.workspaceId} and release_id=${input.releaseId}
          and bundle_id in (
            select id from composition_bundles
            where workspace_id=${input.workspaceId} and release_id=${input.releaseId}
              and storyboard_version_id=${release.storyboard_version_id}
          )
      `;
      await tx`
        update composition_bundles set status='stale'
        where workspace_id=${input.workspaceId} and release_id=${input.releaseId}
          and storyboard_version_id=${release.storyboard_version_id}
      `;
      const updated = await tx<ReleaseRow[]>`
        update releases set storyboard_version_id=${input.candidateId},preview_bundle_id=null,
          stage='storyboard_review',revision=revision+1,updated_at=now()
        where workspace_id=${input.workspaceId} and id=${input.releaseId}
        returning *
      `;
      const updatedRelease = updated[0];
      if (!updatedRelease) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release disappeared during repin");
      const receiptId = randomUUID();
      const result = { release: releaseResult(updatedRelease), stale: staleObjects.map((row) => ({ type: row.object_type as string, id: row.object_id as string })) };
      await tx`
        insert into command_receipts(id,workspace_id,release_id,idempotency_key,fingerprint,result)
        values(${receiptId},${input.workspaceId},${input.releaseId},${input.idempotencyKey},${requestFingerprint},${tx.json(result)})
      `;
      for (const object of staleObjects) {
        await tx`
          insert into release_invalidations(
            workspace_id,release_id,command_receipt_id,changed_ref,previous_version_id,
            replacement_version_id,stale_object_type,stale_object_id
          ) values(
            ${input.workspaceId},${input.releaseId},${receiptId},'storyboard_version',
            ${release.storyboard_version_id},${input.candidateId},${object.object_type},${object.object_id}
          )
        `;
      }
      await tx`insert into audit_events(workspace_id,actor_type,actor_id,event_type,subject_type,subject_id,payload) values(${input.workspaceId},'user',${input.actorId},'release.storyboard_repinned','release',${input.releaseId},${tx.json({ previousVersionId: release.storyboard_version_id, replacementVersionId: input.candidateId, staleCount: staleObjects.length })})`;
      return result;
    });
  }

  async repinFlow(input: ApproveBriefInput) {
    if (!input.idempotencyKey) throw new ReleaseCommandError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required");
    const requestFingerprint = JSON.stringify({ command: "repin_flow", workspaceId: input.workspaceId, releaseId: input.releaseId, candidateId: input.candidateId, expectedRevision: input.expectedRevision, actorId: input.actorId });
    return this.sql.begin(async (tx) => {
      const memberships = await tx`select role from memberships where workspace_id=${input.workspaceId} and user_id=${input.actorId}`;
      if (!memberships[0] || !["owner", "admin"].includes(memberships[0].role)) throw new ReleaseCommandError("COMMAND_FORBIDDEN", "repin requires owner or admin");
      const receipts = await tx`select fingerprint,result from command_receipts where workspace_id=${input.workspaceId} and idempotency_key=${input.idempotencyKey}`;
      if (receipts[0]) {
        if (receipts[0].fingerprint !== requestFingerprint) throw new ReleaseCommandError("IDEMPOTENCY_CONFLICT", "idempotency key belongs to another request");
        return receipts[0].result;
      }
      const releases = await tx<ReleaseRow[]>`select * from releases where workspace_id=${input.workspaceId} and id=${input.releaseId} for update`;
      const release = releases[0];
      if (!release) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release not found");
      if (release.revision !== input.expectedRevision) throw new ReleaseCommandError("REVISION_CONFLICT", `expected revision ${input.expectedRevision}, found ${release.revision}`);
      if (release.lifecycle !== "active" || !release.product_flow_version_id || release.product_flow_version_id === input.candidateId) throw new ReleaseCommandError("REPIN_INVALID", "repin_flow requires a different pinned ProductFlowVersion");
      const candidates = await tx`
        select v.id from product_flow_versions v
        join product_flows f on f.workspace_id=v.workspace_id and f.id=v.product_flow_id
        where v.workspace_id=${input.workspaceId} and v.id=${input.candidateId}
          and v.status='approved' and f.product_id=${release.product_id}
      `;
      if (!candidates[0]) throw new ReleaseCommandError("CANDIDATE_INVALID", "replacement ProductFlowVersion is not approved for this Product");
      const staleObjects = await tx`
        select 'capture_run' as object_type,id as object_id from capture_runs
          where workspace_id=${input.workspaceId} and release_id=${input.releaseId}
        union all
        select 'evidence_package_version',v.id from evidence_package_versions v
          join evidence_packages p on p.workspace_id=v.workspace_id and p.id=v.evidence_package_id
          where v.workspace_id=${input.workspaceId} and p.release_id=${input.releaseId}
        union all
        select 'storyboard_version',v.id from storyboard_versions v
          join storyboards s on s.workspace_id=v.workspace_id and s.id=v.storyboard_id
          where v.workspace_id=${input.workspaceId} and s.release_id=${input.releaseId}
        union all
        select 'composition_bundle',id from composition_bundles
          where workspace_id=${input.workspaceId} and release_id=${input.releaseId}
        union all
        select 'render_job',id from render_jobs
          where workspace_id=${input.workspaceId} and release_id=${input.releaseId}
      `;
      await tx`update render_jobs set status='stale',updated_at=now() where workspace_id=${input.workspaceId} and release_id=${input.releaseId}`;
      await tx`update composition_bundles set status='stale' where workspace_id=${input.workspaceId} and release_id=${input.releaseId}`;
      await tx`update launch_video_jobs set status='stale',updated_at=now() where workspace_id=${input.workspaceId} and release_id=${input.releaseId} and status in ('queued','running','succeeded')`;
      const updated = await tx<ReleaseRow[]>`
        update releases set product_flow_version_id=${input.candidateId},capture_run_id=null,
          evidence_package_version_id=null,storyboard_version_id=null,preview_bundle_id=null,
          stage='capture_pending',revision=revision+1,updated_at=now()
        where workspace_id=${input.workspaceId} and id=${input.releaseId} returning *
      `;
      const updatedRelease = updated[0];
      if (!updatedRelease) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release disappeared during repin");
      const receiptId = randomUUID();
      const result = { release: releaseResult(updatedRelease), stale: staleObjects.map((row) => ({ type: row.object_type as string, id: row.object_id as string })) };
      await tx`insert into command_receipts(id,workspace_id,release_id,idempotency_key,fingerprint,result) values(${receiptId},${input.workspaceId},${input.releaseId},${input.idempotencyKey},${requestFingerprint},${tx.json(result)})`;
      for (const object of staleObjects) {
        await tx`insert into release_invalidations(workspace_id,release_id,command_receipt_id,changed_ref,previous_version_id,replacement_version_id,stale_object_type,stale_object_id) values(${input.workspaceId},${input.releaseId},${receiptId},'product_flow_version',${release.product_flow_version_id},${input.candidateId},${object.object_type},${object.object_id})`;
      }
      await tx`insert into audit_events(workspace_id,actor_type,actor_id,event_type,subject_type,subject_id,payload) values(${input.workspaceId},'user',${input.actorId},'release.flow_repinned','release',${input.releaseId},${tx.json({ previousVersionId: release.product_flow_version_id, replacementVersionId: input.candidateId, staleCount: staleObjects.length })})`;
      return result;
    });
  }

  async repinBrandKit(input: ApproveBriefInput) {
    return this.repinSimple("brand_kit_version", input);
  }

  async repinEvidence(input: ApproveBriefInput) {
    return this.repinSimple("evidence_package_version", input);
  }

  async repinBrief(input: ApproveBriefInput) {
    return this.repinSimple("brief_version", input);
  }

  private async repinSimple(
    changedRef: "brand_kit_version" | "evidence_package_version" | "brief_version",
    input: ApproveBriefInput
  ) {
    if (!input.idempotencyKey) throw new ReleaseCommandError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required");
    const requestFingerprint = JSON.stringify({ command: `repin_${changedRef}`, workspaceId: input.workspaceId, releaseId: input.releaseId, candidateId: input.candidateId, expectedRevision: input.expectedRevision, actorId: input.actorId });
    return this.sql.begin(async (tx) => {
      const memberships = await tx`select role from memberships where workspace_id=${input.workspaceId} and user_id=${input.actorId}`;
      if (!memberships[0] || !["owner", "admin"].includes(memberships[0].role)) throw new ReleaseCommandError("COMMAND_FORBIDDEN", "repin requires owner or admin");
      const receipts = await tx`select fingerprint,result from command_receipts where workspace_id=${input.workspaceId} and idempotency_key=${input.idempotencyKey}`;
      if (receipts[0]) {
        if (receipts[0].fingerprint !== requestFingerprint) throw new ReleaseCommandError("IDEMPOTENCY_CONFLICT", "idempotency key belongs to another request");
        return receipts[0].result;
      }
      const releases = await tx<ReleaseRow[]>`select * from releases where workspace_id=${input.workspaceId} and id=${input.releaseId} for update`;
      const release = releases[0];
      if (!release) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release not found");
      if (release.revision !== input.expectedRevision) throw new ReleaseCommandError("REVISION_CONFLICT", `expected revision ${input.expectedRevision}, found ${release.revision}`);
      if (release.lifecycle !== "active") throw new ReleaseCommandError("REPIN_INVALID", "repin requires an active Release");

      let previousVersionId: string | null;
      let candidateValid = false;
      if (changedRef === "brand_kit_version") {
        previousVersionId = release.brand_kit_version_id;
        const rows = await tx`
          select v.id from brand_kit_versions v
          join brand_kits k on k.workspace_id=v.workspace_id and k.id=v.brand_kit_id
          where v.workspace_id=${input.workspaceId} and v.id=${input.candidateId}
            and v.status='approved' and k.product_id=${release.product_id}
        `;
        candidateValid = Boolean(rows[0]);
      } else if (changedRef === "evidence_package_version") {
        previousVersionId = release.evidence_package_version_id;
        const rows = await tx`
          select v.id from evidence_package_versions v
          join evidence_packages p on p.workspace_id=v.workspace_id and p.id=v.evidence_package_id
          where v.workspace_id=${input.workspaceId} and v.id=${input.candidateId}
            and v.status='approved' and p.release_id=${input.releaseId}
        `;
        candidateValid = Boolean(rows[0]);
      } else {
        previousVersionId = release.brief_version_id;
        const rows = await tx`
          select id from release_brief_versions
          where workspace_id=${input.workspaceId} and id=${input.candidateId}
            and release_id=${input.releaseId} and status='approved'
        `;
        candidateValid = Boolean(rows[0]);
      }
      if (!previousVersionId || previousVersionId === input.candidateId || !candidateValid) {
        throw new ReleaseCommandError("CANDIDATE_INVALID", `replacement ${changedRef} is not a different approved version for this Release`);
      }

      let staleObjects;
      if (changedRef === "brand_kit_version") {
        staleObjects = await tx`
          select 'composition_bundle' as object_type,id as object_id from composition_bundles where workspace_id=${input.workspaceId} and release_id=${input.releaseId}
          union all select 'render_job',id from render_jobs where workspace_id=${input.workspaceId} and release_id=${input.releaseId}
        `;
      } else if (changedRef === "evidence_package_version") {
        staleObjects = await tx`
          select 'storyboard_version' as object_type,v.id as object_id from storyboard_versions v join storyboards s on s.workspace_id=v.workspace_id and s.id=v.storyboard_id where v.workspace_id=${input.workspaceId} and s.release_id=${input.releaseId}
          union all select 'composition_bundle',id from composition_bundles where workspace_id=${input.workspaceId} and release_id=${input.releaseId}
          union all select 'render_job',id from render_jobs where workspace_id=${input.workspaceId} and release_id=${input.releaseId}
        `;
      } else {
        staleObjects = await tx`
          select 'product_flow_version' as object_type,${release.product_flow_version_id}::uuid as object_id where ${release.product_flow_version_id}::uuid is not null
          union all select 'capture_run',id from capture_runs where workspace_id=${input.workspaceId} and release_id=${input.releaseId}
          union all select 'evidence_package_version',v.id from evidence_package_versions v join evidence_packages p on p.workspace_id=v.workspace_id and p.id=v.evidence_package_id where v.workspace_id=${input.workspaceId} and p.release_id=${input.releaseId}
          union all select 'storyboard_version',v.id from storyboard_versions v join storyboards s on s.workspace_id=v.workspace_id and s.id=v.storyboard_id where v.workspace_id=${input.workspaceId} and s.release_id=${input.releaseId}
          union all select 'composition_bundle',id from composition_bundles where workspace_id=${input.workspaceId} and release_id=${input.releaseId}
          union all select 'render_job',id from render_jobs where workspace_id=${input.workspaceId} and release_id=${input.releaseId}
        `;
      }
      await tx`update render_jobs set status='stale',updated_at=now() where workspace_id=${input.workspaceId} and release_id=${input.releaseId}`;
      await tx`update composition_bundles set status='stale' where workspace_id=${input.workspaceId} and release_id=${input.releaseId}`;
      await tx`update launch_video_jobs set status='stale',updated_at=now() where workspace_id=${input.workspaceId} and release_id=${input.releaseId} and status in ('queued','running','succeeded')`;

      let updated;
      if (changedRef === "brand_kit_version") {
        updated = await tx<ReleaseRow[]>`update releases set brand_kit_version_id=${input.candidateId},preview_bundle_id=null,stage='preview_queued',revision=revision+1,updated_at=now() where workspace_id=${input.workspaceId} and id=${input.releaseId} returning *`;
      } else if (changedRef === "evidence_package_version") {
        updated = await tx<ReleaseRow[]>`update releases set evidence_package_version_id=${input.candidateId},storyboard_version_id=null,preview_bundle_id=null,stage='evidence_review',revision=revision+1,updated_at=now() where workspace_id=${input.workspaceId} and id=${input.releaseId} returning *`;
      } else {
        updated = await tx<ReleaseRow[]>`update releases set brief_version_id=${input.candidateId},product_flow_version_id=null,capture_run_id=null,evidence_package_version_id=null,storyboard_version_id=null,preview_bundle_id=null,stage='flow_selecting',revision=revision+1,updated_at=now() where workspace_id=${input.workspaceId} and id=${input.releaseId} returning *`;
      }
      const updatedRelease = updated[0];
      if (!updatedRelease) throw new ReleaseCommandError("RELEASE_NOT_FOUND", "Release disappeared during repin");
      const receiptId = randomUUID();
      const result = { release: releaseResult(updatedRelease), stale: staleObjects.map((row) => ({ type: row.object_type as string, id: row.object_id as string })) };
      await tx`insert into command_receipts(id,workspace_id,release_id,idempotency_key,fingerprint,result) values(${receiptId},${input.workspaceId},${input.releaseId},${input.idempotencyKey},${requestFingerprint},${tx.json(result)})`;
      for (const object of staleObjects) {
        await tx`insert into release_invalidations(workspace_id,release_id,command_receipt_id,changed_ref,previous_version_id,replacement_version_id,stale_object_type,stale_object_id) values(${input.workspaceId},${input.releaseId},${receiptId},${changedRef},${previousVersionId},${input.candidateId},${object.object_type},${object.object_id})`;
      }
      await tx`insert into audit_events(workspace_id,actor_type,actor_id,event_type,subject_type,subject_id,payload) values(${input.workspaceId},'user',${input.actorId},${`release.${changedRef}_repinned`},'release',${input.releaseId},${tx.json({ previousVersionId, replacementVersionId: input.candidateId, staleCount: staleObjects.length })})`;
      return result;
    });
  }
}
