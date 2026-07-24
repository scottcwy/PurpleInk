export const RELEASE_LIFECYCLES = [
  "active",
  "failed",
  "cancelled",
  "delivered",
] as const;

export type ReleaseLifecycle = (typeof RELEASE_LIFECYCLES)[number];

export const RELEASE_STAGES = [
  "brief_draft",
  "flow_selecting",
  "flow_discovering",
  "flow_review",
  "capture_pending",
  "capturing",
  "evidence_review",
  "storyboard_generating",
  "storyboard_review",
  "preview_queued",
  "preview_rendering",
  "preview_review",
  "final_queued",
  "final_rendering",
  "complete",
] as const;

export type ReleaseStage = (typeof RELEASE_STAGES)[number];

export const releaseSteps = [
  { slug: "brief", label: "Brief" },
  { slug: "flow", label: "Flow" },
  { slug: "evidence", label: "Evidence" },
  { slug: "storyboard", label: "Storyboard" },
  { slug: "review", label: "Review" },
  { slug: "artifacts", label: "Artifacts" },
] as const;

export type ReleaseStepSlug = (typeof releaseSteps)[number]["slug"];

const stageStep: Record<ReleaseStage, ReleaseStepSlug> = {
  brief_draft: "brief",
  flow_selecting: "flow",
  flow_discovering: "flow",
  flow_review: "flow",
  capture_pending: "evidence",
  capturing: "evidence",
  evidence_review: "evidence",
  storyboard_generating: "storyboard",
  storyboard_review: "storyboard",
  preview_queued: "review",
  preview_rendering: "review",
  preview_review: "review",
  final_queued: "artifacts",
  final_rendering: "artifacts",
  complete: "artifacts",
};

type ReleaseRouteState = Pick<Release, "id" | "lifecycle" | "stage"> & {
  failedFromStage?: ReleaseStage | null;
};

export type ReleaseRouteAccess =
  | {
      allowed: true;
      blockedBy?: never;
      returnHref?: never;
      reason?: never;
    }
  | {
      allowed: false;
      blockedBy: ReleaseStepSlug;
      returnHref: string;
      reason: string;
    };

export function getReleaseRouteAccess(
  release: ReleaseRouteState,
  requestedStep: ReleaseStepSlug
): ReleaseRouteAccess {
  const effectiveStage =
    release.lifecycle === "failed" && release.failedFromStage
      ? release.failedFromStage
      : release.stage;
  const availableStep = stageStep[effectiveStage];
  const availableIndex = releaseSteps.findIndex(
    ({ slug }) => slug === availableStep
  );
  const requestedIndex = releaseSteps.findIndex(
    ({ slug }) => slug === requestedStep
  );
  if (requestedIndex <= availableIndex) return { allowed: true };

  const label = releaseSteps[availableIndex]?.label ?? "current step";
  return {
    allowed: false,
    blockedBy: availableStep,
    returnHref: `/releases/${release.id}/${availableStep}`,
    reason: `${label} must be completed before continuing.`,
  };
}

export const TRANSITION_TABLE = [
  {
    command: "approve_brief",
    from: "brief_draft",
    to: "flow_selecting",
    guard: "approved ReleaseBriefVersion",
  },
  {
    command: "start_discovery",
    from: "flow_selecting",
    to: "flow_discovering",
    guard: "available Playwright Capture Worker and valid Product URL",
  },
  {
    command: "discovery_completed",
    from: "flow_discovering",
    to: "flow_review",
    guard: "valid draft schema and passed clean replay",
  },
  {
    command: "approve_flow",
    from: "flow_review",
    to: "capture_pending",
    guard: "valid draft ProductFlowVersion",
  },
  {
    command: "select_flow_version",
    from: "flow_selecting",
    to: "capture_pending",
    guard: "existing approved ProductFlowVersion",
  },
  {
    command: "start_capture",
    from: "capture_pending",
    to: "capturing",
    guard: "active device and no active run",
  },
  {
    command: "capture_completed",
    from: "capturing",
    to: "evidence_review",
    guard: "verified manifest",
  },
  {
    command: "approve_evidence",
    from: "evidence_review",
    to: "storyboard_generating",
    guard: "required nodes passed and approved",
  },
  {
    command: "storyboard_generated",
    from: "storyboard_generating",
    to: "storyboard_review",
    guard: "valid schema and provenance",
  },
  {
    command: "approve_storyboard",
    from: "storyboard_review",
    to: "preview_queued",
    guard: "approved StoryboardVersion",
  },
  {
    command: "preview_started",
    from: "preview_queued",
    to: "preview_rendering",
    guard: "fenced RenderAttempt",
  },
  {
    command: "preview_completed",
    from: "preview_rendering",
    to: "preview_review",
    guard: "passed quality gates",
  },
  {
    command: "revise_storyboard",
    from: "preview_review",
    to: "storyboard_review",
    guard: "recorded copy, fact, or evidence feedback",
  },
  {
    command: "revise_visual_plan",
    from: "preview_review",
    to: "preview_queued",
    guard: "recorded visual feedback and valid Storyboard",
  },
  {
    command: "approve_preview",
    from: "preview_review",
    to: "final_queued",
    guard: "approved current bundle",
  },
  {
    command: "final_started",
    from: "final_queued",
    to: "final_rendering",
    guard: "frozen required outputs",
  },
  {
    command: "final_completed",
    from: "final_rendering",
    to: "complete",
    guard: "all required outputs published",
  },
] as const satisfies readonly {
  command: string;
  from: ReleaseStage;
  to: ReleaseStage;
  guard: string;
}[];

type TableCommandName = (typeof TRANSITION_TABLE)[number]["command"];
export type ReleaseCommandName = TableCommandName | "retry" | "cancel";

export const APPROVAL_COMMANDS = [
  "approve_brief",
  "approve_flow",
  "approve_evidence",
  "approve_storyboard",
  "approve_preview",
] as const satisfies readonly ReleaseCommandName[];

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export interface ReleaseActorContext {
  workspaceId: string;
  actorId: string;
  role: WorkspaceRole;
}

export interface ReleaseRefsV1 {
  briefVersionId?: string;
  productFlowVersionId?: string;
  captureRunId?: string;
  evidencePackageVersionId?: string;
  storyboardVersionId?: string;
  brandKitVersionId?: string;
  previewBundleId?: string;
}

export type StaleDependency =
  | "flow_selection"
  | "capture_run"
  | "evidence"
  | "storyboard"
  | "bundle"
  | "composition_bundle"
  | "render_job";

export interface Release {
  id: string;
  workspaceId: string;
  productId: string;
  lifecycle: ReleaseLifecycle;
  stage: ReleaseStage;
  failedFromStage: ReleaseStage | null;
  revision: number;
  refs: ReleaseRefsV1;
  stale: StaleDependency[];
  retryAttempts: Partial<Record<ReleaseStage, number>>;
}

interface MutationEnvelope {
  releaseId: string;
  expectedRevision: number;
  idempotencyKey: string;
}

export interface ReleaseCommand extends MutationEnvelope {
  name: ReleaseCommandName;
  subjectId?: string;
  brandKitVersionId?: string;
}

export interface FailReleaseCommand extends MutationEnvelope {
  errorCode: string;
}

export interface RejectCandidateCommand extends MutationEnvelope {
  subjectType: ApprovalSubjectType;
  subjectId: string;
}

export type UpstreamChange =
  | "release_brief"
  | "product_flow_version"
  | "node_evidence_approval"
  | "storyboard_version"
  | "brand_kit_version";

export interface UpstreamChangeCommand extends MutationEnvelope {
  change: UpstreamChange;
  replacementRefId?: string;
}

export type ApprovalSubjectType =
  | "release_brief_version"
  | "product_flow_version"
  | "node_evidence"
  | "evidence_package_version"
  | "storyboard_version"
  | "composition_bundle";

export interface Approval {
  id: string;
  workspaceId: string;
  releaseId: string;
  subjectType: ApprovalSubjectType;
  subjectId: string;
  decision: "approved" | "rejected";
  actorId: string;
  createdAt: Date;
}

export interface ReleaseCommandResult {
  release: Release;
  approval?: Approval;
  retryAttempt?: {
    stage: ReleaseStage;
    attempt: number;
  };
}

export class ReleaseDomainError extends Error {}
export class ReleaseNotFoundError extends ReleaseDomainError {}
export class ReleaseConflictError extends ReleaseDomainError {}
export class ReleaseTransitionError extends ReleaseDomainError {}
export class ReleasePermissionError extends ReleaseDomainError {}
export class ReleaseGuardError extends ReleaseDomainError {}
export class IdempotencyKeyConflictError extends ReleaseDomainError {}

export interface ReleaseGuardPort {
  assertSatisfied(
    context: ReleaseActorContext,
    release: Readonly<Release>,
    mutation: Readonly<
      ReleaseCommand | UpstreamChangeCommand | RejectCandidateCommand
    >,
    guard: string
  ): Promise<void>;
}

export const ALLOW_ALL_RELEASE_GUARDS: ReleaseGuardPort = Object.freeze({
  async assertSatisfied() {},
});

export interface CommandReceipt {
  fingerprint: string;
  result: ReleaseCommandResult;
}

export interface ReleaseTransaction {
  getRelease(releaseId: string): Promise<Release | undefined>;
  saveRelease(release: Release): Promise<void>;
  getReceipt(idempotencyKey: string): Promise<CommandReceipt | undefined>;
  saveReceipt(idempotencyKey: string, receipt: CommandReceipt): Promise<void>;
  appendApproval(approval: Approval): Promise<void>;
}

export interface ReleaseRepository {
  transaction<T>(
    releaseId: string,
    work: (transaction: ReleaseTransaction) => Promise<T>
  ): Promise<T>;
}

const approvalSubjects: Partial<
  Record<ReleaseCommandName, ApprovalSubjectType>
> = {
  approve_brief: "release_brief_version",
  approve_flow: "product_flow_version",
  approve_evidence: "evidence_package_version",
  approve_storyboard: "storyboard_version",
  approve_preview: "composition_bundle",
};

const upstreamEffects: Record<
  UpstreamChange,
  { stage: ReleaseStage; stale: StaleDependency[]; ref?: keyof ReleaseRefsV1 }
> = {
  release_brief: {
    stage: "flow_selecting",
    stale: ["flow_selection", "evidence", "storyboard", "bundle"],
    ref: "briefVersionId",
  },
  product_flow_version: {
    stage: "capture_pending",
    stale: ["capture_run", "evidence", "storyboard", "bundle"],
    ref: "productFlowVersionId",
  },
  node_evidence_approval: {
    stage: "evidence_review",
    stale: ["storyboard", "bundle"],
  },
  storyboard_version: {
    stage: "storyboard_review",
    stale: ["composition_bundle", "render_job"],
    ref: "storyboardVersionId",
  },
  brand_kit_version: {
    stage: "preview_queued",
    stale: ["composition_bundle", "render_job"],
  },
};

function cloneRelease(value: Release): Release {
  return {
    ...value,
    refs: { ...value.refs },
    stale: [...value.stale],
    retryAttempts: { ...value.retryAttempts },
  };
}

function cloneApproval(value: Approval): Approval {
  return { ...value, createdAt: new Date(value.createdAt) };
}

function cloneResult(value: ReleaseCommandResult): ReleaseCommandResult {
  const result: ReleaseCommandResult = { release: cloneRelease(value.release) };
  if (value.approval) result.approval = cloneApproval(value.approval);
  if (value.retryAttempt) result.retryAttempt = { ...value.retryAttempt };
  return result;
}

function assertPermission(
  context: ReleaseActorContext,
  command: ReleaseCommandName | "fail" | "upstream_change" | "approval_decision"
): void {
  if (context.role === "viewer") {
    throw new ReleasePermissionError("viewer cannot mutate a Release");
  }
  if (
    (APPROVAL_COMMANDS as readonly string[]).includes(command) ||
    command === "cancel" ||
    command === "approval_decision"
  ) {
    if (context.role !== "owner" && context.role !== "admin") {
      throw new ReleasePermissionError(`${command} requires owner or admin`);
    }
  }
}

function assertReleaseScope(
  context: ReleaseActorContext,
  release: Release
): void {
  if (context.workspaceId !== release.workspaceId) {
    throw new ReleasePermissionError("Release belongs to another workspace");
  }
}

function assertExpectedRevision(
  release: Release,
  expectedRevision: number
): void {
  if (release.revision !== expectedRevision) {
    throw new ReleaseConflictError(
      `expected revision ${expectedRevision}, found ${release.revision}`
    );
  }
}

function receiptFingerprint(kind: string, payload: object): string {
  return JSON.stringify([kind, payload]);
}

export class ReleaseDomainService {
  constructor(
    private readonly repository: ReleaseRepository,
    private readonly guards: ReleaseGuardPort,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID()
  ) {}

  async execute(
    context: ReleaseActorContext,
    command: ReleaseCommand
  ): Promise<ReleaseCommandResult> {
    const fingerprint = receiptFingerprint("command", {
      name: command.name,
      subjectId: command.subjectId,
    });
    return this.mutate(
      context,
      command,
      fingerprint,
      command.name,
      async (release, transaction) => {
        if (command.name === "retry") return this.retry(release);
        if (command.name === "cancel") return this.cancel(release);
        if (release.lifecycle !== "active") {
          throw new ReleaseTransitionError(
            `${command.name} requires active lifecycle`
          );
        }

        const transition = TRANSITION_TABLE.find(
          (candidate) => candidate.command === command.name
        );
        if (!transition || transition.from !== release.stage) {
          throw new ReleaseTransitionError(
            `${command.name} is invalid from ${release.stage}`
          );
        }
        await this.guards.assertSatisfied(
          context,
          cloneRelease(release),
          command,
          transition.guard
        );

        release.stage = transition.to;
        if (command.name === "final_completed") release.lifecycle = "delivered";

        this.updateFixedReference(release, command);

        const subjectType = approvalSubjects[command.name];
        if (!subjectType) return { release };
        if (!command.subjectId) {
          throw new ReleaseGuardError(`${command.name} requires subjectId`);
        }
        const approval: Approval = {
          id: this.createId(),
          workspaceId: release.workspaceId,
          releaseId: release.id,
          subjectType,
          subjectId: command.subjectId,
          decision: "approved",
          actorId: context.actorId,
          createdAt: this.now(),
        };
        await transaction.appendApproval(approval);
        return { release, approval };
      }
    );
  }

  async fail(
    context: ReleaseActorContext,
    command: FailReleaseCommand
  ): Promise<ReleaseCommandResult> {
    const fingerprint = receiptFingerprint("fail", {
      errorCode: command.errorCode,
    });
    return this.mutate(
      context,
      command,
      fingerprint,
      "fail",
      async (release) => {
        if (release.lifecycle !== "active" || release.stage === "complete") {
          throw new ReleaseTransitionError("only an active Release can fail");
        }
        release.lifecycle = "failed";
        release.failedFromStage = release.stage;
        return { release };
      }
    );
  }

  async rejectCandidate(
    context: ReleaseActorContext,
    command: RejectCandidateCommand
  ): Promise<ReleaseCommandResult> {
    const fingerprint = receiptFingerprint("reject_candidate", {
      subjectType: command.subjectType,
      subjectId: command.subjectId,
    });
    return this.mutate(
      context,
      command,
      fingerprint,
      "approval_decision",
      async (release, transaction) => {
        const reviewStages: Record<ApprovalSubjectType, ReleaseStage> = {
          release_brief_version: "brief_draft",
          product_flow_version: "flow_review",
          node_evidence: "evidence_review",
          evidence_package_version: "evidence_review",
          storyboard_version: "storyboard_review",
          composition_bundle: "preview_review",
        };
        if (
          release.lifecycle !== "active" ||
          release.stage !== reviewStages[command.subjectType]
        ) {
          throw new ReleaseTransitionError(
            `cannot reject ${command.subjectType} from ${release.stage}`
          );
        }
        await this.guards.assertSatisfied(
          context,
          cloneRelease(release),
          command,
          "subject belongs to the workspace and Release and is a review candidate"
        );
        const approval: Approval = {
          id: this.createId(),
          workspaceId: release.workspaceId,
          releaseId: release.id,
          subjectType: command.subjectType,
          subjectId: command.subjectId,
          decision: "rejected",
          actorId: context.actorId,
          createdAt: this.now(),
        };
        await transaction.appendApproval(approval);
        return { release, approval };
      }
    );
  }

  async propagateUpstreamChange(
    context: ReleaseActorContext,
    command: UpstreamChangeCommand
  ): Promise<ReleaseCommandResult> {
    const fingerprint = receiptFingerprint("upstream_change", {
      change: command.change,
      replacementRefId: command.replacementRefId,
    });
    return this.mutate(
      context,
      command,
      fingerprint,
      "upstream_change",
      async (release) => {
        if (release.lifecycle !== "active") {
          throw new ReleaseTransitionError(
            "upstream changes require active lifecycle"
          );
        }
        const effect = upstreamEffects[command.change];
        await this.guards.assertSatisfied(
          context,
          cloneRelease(release),
          command,
          "replacement version belongs to the workspace, Product, and Release and has the required approval status"
        );
        release.stage = effect.stage;
        release.stale = [...new Set([...release.stale, ...effect.stale])];
        if (effect.ref && command.replacementRefId) {
          release.refs[effect.ref] = command.replacementRefId;
        }
        return { release };
      }
    );
  }

  private retry(release: Release): ReleaseCommandResult {
    if (release.lifecycle !== "failed" || !release.failedFromStage) {
      throw new ReleaseTransitionError("retry requires a failed Release");
    }
    const stage = release.failedFromStage;
    release.lifecycle = "active";
    release.stage = stage;
    release.failedFromStage = null;
    const attempt = (release.retryAttempts[stage] ?? 0) + 1;
    release.retryAttempts[stage] = attempt;
    return { release, retryAttempt: { stage, attempt } };
  }

  private updateFixedReference(
    release: Release,
    command: ReleaseCommand
  ): void {
    const referenceFields: Partial<
      Record<ReleaseCommandName, keyof ReleaseRefsV1>
    > = {
      approve_brief: "briefVersionId",
      approve_flow: "productFlowVersionId",
      select_flow_version: "productFlowVersionId",
      start_capture: "captureRunId",
      approve_evidence: "evidencePackageVersionId",
      approve_storyboard: "storyboardVersionId",
      approve_preview: "previewBundleId",
    };
    const field = referenceFields[command.name];
    if (!field) return;
    if (!command.subjectId) {
      throw new ReleaseGuardError(`${command.name} requires subjectId`);
    }
    release.refs[field] = command.subjectId;
    if (command.name === "approve_evidence") {
      if (!command.brandKitVersionId) {
        throw new ReleaseGuardError(
          "approve_evidence requires brandKitVersionId"
        );
      }
      release.refs.brandKitVersionId = command.brandKitVersionId;
    }
  }

  private cancel(release: Release): ReleaseCommandResult {
    if (
      release.lifecycle === "cancelled" ||
      release.lifecycle === "delivered"
    ) {
      throw new ReleaseTransitionError(
        `cannot cancel a ${release.lifecycle} Release`
      );
    }
    release.lifecycle = "cancelled";
    release.failedFromStage = null;
    return { release };
  }

  private async mutate(
    context: ReleaseActorContext,
    envelope: MutationEnvelope,
    fingerprint: string,
    permission:
      ReleaseCommandName | "fail" | "upstream_change" | "approval_decision",
    change: (
      release: Release,
      transaction: ReleaseTransaction
    ) => Promise<ReleaseCommandResult>
  ): Promise<ReleaseCommandResult> {
    if (!envelope.idempotencyKey) {
      throw new IdempotencyKeyConflictError("idempotencyKey is required");
    }
    return this.repository.transaction(
      envelope.releaseId,
      async (transaction) => {
        const release = await transaction.getRelease(envelope.releaseId);
        if (!release) throw new ReleaseNotFoundError("Release not found");
        assertReleaseScope(context, release);
        assertPermission(context, permission);

        const existing = await transaction.getReceipt(envelope.idempotencyKey);
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            throw new IdempotencyKeyConflictError(
              "idempotency key was used for a different mutation"
            );
          }
          return cloneResult(existing.result);
        }

        assertExpectedRevision(release, envelope.expectedRevision);

        const result = await change(release, transaction);
        result.release.revision += 1;
        await transaction.saveRelease(result.release);
        await transaction.saveReceipt(envelope.idempotencyKey, {
          fingerprint,
          result: cloneResult(result),
        });
        return cloneResult(result);
      }
    );
  }
}

export class InMemoryReleaseRepository implements ReleaseRepository {
  private readonly releases = new Map<string, Release>();
  private readonly receipts = new Map<string, Map<string, CommandReceipt>>();
  private approvalRecords: Approval[] = [];
  private readonly locks = new Map<string, Promise<void>>();

  constructor(initial: readonly Release[] = []) {
    for (const release of initial)
      this.releases.set(release.id, cloneRelease(release));
  }

  get approvals(): readonly Approval[] {
    return Object.freeze(
      this.approvalRecords.map((item) => Object.freeze(cloneApproval(item)))
    );
  }

  async get(releaseId: string): Promise<Release | undefined> {
    const value = this.releases.get(releaseId);
    return value ? cloneRelease(value) : undefined;
  }

  async transaction<T>(
    releaseId: string,
    work: (transaction: ReleaseTransaction) => Promise<T>
  ): Promise<T> {
    const previous = this.locks.get(releaseId) ?? Promise.resolve();
    let unlock = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const queued = previous.then(() => current);
    this.locks.set(releaseId, queued);
    await previous;

    const stagedRelease = this.releases.get(releaseId);
    let nextRelease = stagedRelease ? cloneRelease(stagedRelease) : undefined;
    const existingReceipts = this.receipts.get(releaseId) ?? new Map();
    const nextReceipts = new Map(existingReceipts);
    const nextApprovals = [...this.approvalRecords];
    const transaction: ReleaseTransaction = {
      getRelease: async (id) =>
        id === releaseId && nextRelease ? cloneRelease(nextRelease) : undefined,
      saveRelease: async (value) => {
        if (value.id !== releaseId)
          throw new ReleaseConflictError("wrong Release");
        nextRelease = cloneRelease(value);
      },
      getReceipt: async (key) => {
        const receipt = nextReceipts.get(key);
        return receipt
          ? {
              fingerprint: receipt.fingerprint,
              result: cloneResult(receipt.result),
            }
          : undefined;
      },
      saveReceipt: async (key, receipt) => {
        nextReceipts.set(key, {
          fingerprint: receipt.fingerprint,
          result: cloneResult(receipt.result),
        });
      },
      appendApproval: async (approval) => {
        nextApprovals.push(cloneApproval(approval));
      },
    };

    try {
      const result = await work(transaction);
      if (nextRelease) this.releases.set(releaseId, cloneRelease(nextRelease));
      this.receipts.set(releaseId, nextReceipts);
      this.approvalRecords = nextApprovals;
      return result;
    } finally {
      unlock();
      if (this.locks.get(releaseId) === queued) this.locks.delete(releaseId);
    }
  }
}
