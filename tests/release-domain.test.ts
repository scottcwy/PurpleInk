import { describe, expect, it } from "vitest";

import {
  APPROVAL_COMMANDS,
  ALLOW_ALL_RELEASE_GUARDS,
  IdempotencyKeyConflictError,
  InMemoryReleaseRepository,
  ReleaseConflictError,
  ReleaseDomainService,
  ReleaseGuardError,
  ReleasePermissionError,
  ReleaseTransitionError,
  TRANSITION_TABLE,
  type Release,
  type ReleaseCommandName,
  type ReleaseStage,
  type UpstreamChange,
} from "@/lib/releases/domain";

const admin = {
  workspaceId: "workspace-1",
  actorId: "admin-1",
  role: "admin" as const,
};
const member = { ...admin, actorId: "member-1", role: "member" as const };

function release(stage: ReleaseStage = "brief_draft"): Release {
  return {
    id: "release-1",
    workspaceId: admin.workspaceId,
    productId: "product-1",
    lifecycle: "active",
    stage,
    failedFromStage: null,
    revision: 1,
    refs: {
      briefVersionId: "brief-1",
      productFlowVersionId: "flow-1",
      captureRunId: "capture-1",
      storyboardVersionId: "storyboard-1",
      previewBundleId: "bundle-1",
    },
    stale: [],
    retryAttempts: {},
  };
}

function command(name: ReleaseCommandName, expectedRevision = 1) {
  return {
    releaseId: "release-1",
    name,
    expectedRevision,
    idempotencyKey: `key-${name}-${expectedRevision}`,
    subjectId: `subject-${name}`,
    ...(name === "approve_evidence"
      ? { brandKitVersionId: "brand-kit-version-1" }
      : {}),
  } as const;
}

function serviceFor(initial: Release) {
  const repository = new InMemoryReleaseRepository([initial]);
  return {
    repository,
    service: new ReleaseDomainService(repository, ALLOW_ALL_RELEASE_GUARDS),
  };
}

describe("Release transition table", () => {
  it.each(TRANSITION_TABLE)(
    "applies $command from $from to $to",
    async (row) => {
      const { service } = serviceFor(release(row.from));

      const result = await service.execute(admin, command(row.command));

      expect(result.release.stage).toBe(row.to);
      expect(result.release.lifecycle).toBe(
        row.command === "final_completed" ? "delivered" : "active"
      );
      expect(result.release.revision).toBe(2);
    }
  );

  it.each([
    ["approve_brief", "briefVersionId"],
    ["approve_flow", "productFlowVersionId"],
    ["select_flow_version", "productFlowVersionId"],
    ["start_capture", "captureRunId"],
    ["approve_storyboard", "storyboardVersionId"],
    ["approve_preview", "previewBundleId"],
  ] as const)("pins the subject for %s", async (name, refName) => {
    const row = TRANSITION_TABLE.find(
      (transition) => transition.command === name
    );
    const { service } = serviceFor(release(row?.from));

    const result = await service.execute(admin, command(name));

    expect(result.release.refs[refName]).toBe(`subject-${name}`);
  });

  it("pins the frozen evidence package and BrandKit in approve_evidence", async () => {
    const { service } = serviceFor(release("evidence_review"));

    const result = await service.execute(admin, {
      ...command("approve_evidence"),
      subjectId: "evidence-package-version-2",
      brandKitVersionId: "brand-kit-version-4",
    });

    expect(result.release.refs.evidencePackageVersionId).toBe(
      "evidence-package-version-2"
    );
    expect(result.release.refs.brandKitVersionId).toBe("brand-kit-version-4");
    expect(result.approval?.subjectType).toBe("evidence_package_version");
  });

  it.each(TRANSITION_TABLE)("rejects $command outside $from", async (row) => {
    const wrongStage =
      row.from === "brief_draft" ? "flow_selecting" : "brief_draft";
    const { service } = serviceFor(release(wrongStage));

    await expect(
      service.execute(admin, command(row.command))
    ).rejects.toBeInstanceOf(ReleaseTransitionError);
  });
});

describe("command consistency", () => {
  it("returns the first result for a duplicate idempotency key", async () => {
    const { repository, service } = serviceFor(release());
    const first = await service.execute(admin, command("approve_brief"));
    const duplicate = await service.execute(admin, command("approve_brief"));

    expect(duplicate).toEqual(first);
    expect((await repository.get("release-1"))?.revision).toBe(2);
    expect(repository.approvals).toHaveLength(1);
  });

  it("allows only one concurrent writer at the same expected revision", async () => {
    const { service } = serviceFor(release());
    const attempts = await Promise.allSettled([
      service.execute(admin, {
        ...command("approve_brief"),
        idempotencyKey: "writer-1",
      }),
      service.execute(admin, {
        ...command("approve_brief"),
        idempotencyKey: "writer-2",
      }),
    ]);

    expect(
      attempts.filter(({ status }) => status === "fulfilled")
    ).toHaveLength(1);
    const rejected = attempts.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      reason: expect.any(ReleaseConflictError),
    });
  });

  it("rejects reuse of an idempotency key for different command input", async () => {
    const { service } = serviceFor(release());
    await service.execute(admin, command("approve_brief"));

    await expect(
      service.execute(admin, {
        ...command("approve_brief"),
        subjectId: "different-brief",
      })
    ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);
  });

  it("does not commit when a command guard fails", async () => {
    const repository = new InMemoryReleaseRepository([release("capturing")]);
    const service = new ReleaseDomainService(repository, {
      async assertSatisfied() {
        throw new ReleaseGuardError("manifest verification failed");
      },
    });

    await expect(
      service.execute(admin, command("capture_completed"))
    ).rejects.toBeInstanceOf(ReleaseGuardError);
    expect(await repository.get("release-1")).toMatchObject({
      stage: "capturing",
      revision: 1,
    });
  });
});

describe("failure recovery", () => {
  it("records the failed stage and creates a new retry attempt", async () => {
    const { service } = serviceFor(release("preview_rendering"));
    const failed = await service.fail(admin, {
      releaseId: "release-1",
      expectedRevision: 1,
      idempotencyKey: "fail-preview",
      errorCode: "renderer_timeout",
    });

    expect(failed.release).toMatchObject({
      lifecycle: "failed",
      stage: "preview_rendering",
      failedFromStage: "preview_rendering",
      revision: 2,
    });

    const retried = await service.execute(admin, {
      ...command("retry", 2),
      idempotencyKey: "retry-preview",
    });
    expect(retried.release).toMatchObject({
      lifecycle: "active",
      stage: "preview_rendering",
      failedFromStage: null,
      retryAttempts: { preview_rendering: 1 },
      revision: 3,
    });
    expect(retried.retryAttempt).toEqual({
      stage: "preview_rendering",
      attempt: 1,
    });
  });

  it("cancels without deleting references", async () => {
    const initial = release("capturing");
    const { service } = serviceFor(initial);

    const result = await service.execute(admin, command("cancel"));

    expect(result.release.lifecycle).toBe("cancelled");
    expect(result.release.refs).toEqual(initial.refs);
  });

  it("rejects retry for an active release and cancel for a delivered release", async () => {
    const active = serviceFor(release("capturing"));
    await expect(
      active.service.execute(admin, command("retry"))
    ).rejects.toBeInstanceOf(ReleaseTransitionError);

    const deliveredRelease = release("complete");
    deliveredRelease.lifecycle = "delivered";
    const delivered = serviceFor(deliveredRelease);
    await expect(
      delivered.service.execute(admin, command("cancel"))
    ).rejects.toBeInstanceOf(ReleaseTransitionError);
  });
});

describe("downstream stale propagation", () => {
  const cases: Array<{
    change: UpstreamChange;
    stage: ReleaseStage;
    stale: string[];
  }> = [
    {
      change: "release_brief",
      stage: "flow_selecting",
      stale: ["flow_selection", "evidence", "storyboard", "bundle"],
    },
    {
      change: "product_flow_version",
      stage: "capture_pending",
      stale: ["capture_run", "evidence", "storyboard", "bundle"],
    },
    {
      change: "node_evidence_approval",
      stage: "evidence_review",
      stale: ["storyboard", "bundle"],
    },
    {
      change: "storyboard_version",
      stage: "storyboard_review",
      stale: ["composition_bundle", "render_job"],
    },
    {
      change: "brand_kit_version",
      stage: "preview_queued",
      stale: ["composition_bundle", "render_job"],
    },
  ];

  it.each(cases)(
    "propagates $change staleness",
    async ({ change, stage, stale }) => {
      const { service } = serviceFor(release("final_queued"));

      const result = await service.propagateUpstreamChange(admin, {
        releaseId: "release-1",
        change,
        expectedRevision: 1,
        idempotencyKey: `change-${change}`,
      });

      expect(result.release.stage).toBe(stage);
      expect(result.release.stale).toEqual(stale);
    }
  );
});

describe("approvals and permissions", () => {
  it.each(APPROVAL_COMMANDS)(
    "requires admin permission for %s",
    async (name) => {
      const row = TRANSITION_TABLE.find(
        (transition) => transition.command === name
      );
      const { service } = serviceFor(release(row?.from));

      await expect(
        service.execute(member, command(name))
      ).rejects.toBeInstanceOf(ReleasePermissionError);
    }
  );

  it("appends approval decisions and exposes immutable snapshots", async () => {
    const { repository, service } = serviceFor(release());
    await service.execute(admin, command("approve_brief"));

    const snapshot = repository.approvals;
    expect(snapshot).toMatchObject([
      {
        workspaceId: admin.workspaceId,
        releaseId: "release-1",
        subjectType: "release_brief_version",
        subjectId: "subject-approve_brief",
        decision: "approved",
        actorId: admin.actorId,
      },
    ]);
    expect(() =>
      (snapshot as (typeof snapshot)[number][]).push(snapshot[0]!)
    ).toThrow();
    expect(repository.approvals).toHaveLength(1);
  });

  it("appends rejection without advancing the review stage", async () => {
    const { repository, service } = serviceFor(release("flow_review"));

    const result = await service.rejectCandidate(admin, {
      releaseId: "release-1",
      expectedRevision: 1,
      idempotencyKey: "reject-flow",
      subjectType: "product_flow_version",
      subjectId: "flow-draft-2",
    });

    expect(result.release.stage).toBe("flow_review");
    expect(repository.approvals.at(-1)?.decision).toBe("rejected");
  });
});
